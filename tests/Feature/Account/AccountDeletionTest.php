<?php

declare(strict_types=1);

use App\Domain\Identity\Contracts\AccountDeletionStep;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\Accepted;
use App\Domain\Orders\States\Cancelled;
use App\Domain\Orders\States\Closed;
use App\Domain\Orders\States\Submitted;
use App\Domain\Orders\Support\DeleteNeverSubmittedDraftOrders;
use App\Domain\Projects\Models\Project;
use App\Notifications\Account\DeletionScheduled;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\RegistryFixtures;
use Tests\Support\SessionStamp;

beforeEach(function (): void {
    $this->customer = User::factory()->create(['email' => 'asha@example.com', 'name' => 'Asha']);
    $this->recent = fn () => $this->actingAs($this->customer)->withSession(SessionStamp::loginHoursAgo(0));
    $this->delete = fn (string $word = 'DELETE') => ($this->recent)()->deleteJson(route('customer.account.destroy'), ['confirmation' => $word]);
});

afterEach(function (): void {
    RegistryFixtures::clean($this->customer);
});

/** An order of the customer in `$state`, with its own project. */
function orderOf(User $customer, string $state): Order
{
    $project = Project::factory()->forCustomer($customer)->create();

    return Order::factory()->state(['project_id' => $project->id])->inState($state)->create();
}

it('has the routes of 14 §4 and §9', function (): void {
    expect(route('customer.account.delete', absolute: false))->toBe('/account')
        ->and(route('customer.account.destroy', absolute: false))->toBe('/account')
        ->and(route('account.deletion-scheduled', absolute: false))->toBe('/account-deleted');
});

describe('the page', function (): void {
    it('shows the Active orders that block a deletion and whether the data can be exported', function (): void {
        $order = orderOf($this->customer, Submitted::class);
        orderOf($this->customer, Closed::class);
        orderOf($this->customer, Cancelled::class);

        ($this->recent)()->get(route('customer.account.delete'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('Customer/Account/Delete')
                ->where('activeOrders', [['id' => $order->id, 'number' => $order->number]])
                ->where('canExport', true));
    });

    it('cannot export for a customer whose contact is not verified', function (): void {
        $this->customer->forceFill(['email_verified_at' => null])->save();

        ($this->recent)()->get(route('customer.account.delete'))
            ->assertInertia(fn (Assert $page) => $page->where('canExport', false)->where('activeOrders', []));
    });

    it('asks for a recent authentication first', function (): void {
        $this->actingAs($this->customer)->get(route('customer.account.delete'))->assertRedirectToRoute('password.confirm');
    });
});

describe('requesting the deletion', function (): void {
    it('refuses with the numbers of the Active orders and changes nothing', function (): void {
        Notification::fake();
        $submitted = orderOf($this->customer, Submitted::class);
        $accepted = orderOf($this->customer, Accepted::class);

        ($this->delete)()
            ->assertUnprocessable()
            ->assertJsonPath('code', 'active_orders')
            ->assertJsonPath('message', trans_icu('account.errors.active_orders', ['numbers' => $submitted->number.', '.$accepted->number]));

        expect(User::query()->find($this->customer->id))->not->toBeNull();
        Notification::assertNothingSent();
    });

    it('lets a customer with only finished orders go', function (): void {
        orderOf($this->customer, Closed::class);
        orderOf($this->customer, Cancelled::class);

        ($this->delete)()->assertRedirectToRoute('account.deletion-scheduled');

        expect(User::withTrashed()->findOrFail($this->customer->id)->trashed())->toBeTrue();
    });

    it('hard-deletes the drafts that were never submitted, soft-deletes the user and signs them out', function (): void {
        Notification::fake();
        $project = Project::factory()->forCustomer($this->customer)->create();
        $draft = Order::factory()->state(['project_id' => $project->id])->withItems(2)->create();
        $session = RegistryFixtures::open($this->customer);
        $this->customer->updatePushSubscription('https://push.example/endpoint-asha', 'key', 'token', 'aesgcm');

        ($this->delete)()
            ->assertRedirectToRoute('account.deletion-scheduled')
            ->assertSessionHas('anonymiseOn', now()->setTimezone('Asia/Kolkata')->addDays(30)->toDateString());

        $this->assertGuest();
        expect(Order::withTrashed()->whereKey($draft->id)->exists())->toBeFalse()
            ->and(DB::table('order_items')->where('order_id', $draft->id)->exists())->toBeFalse()
            ->and(User::withTrashed()->findOrFail($this->customer->id)->deleted_at)->not->toBeNull()
            ->and(DB::table('push_subscriptions')->where('subscribable_id', $this->customer->id)->exists())->toBeFalse()
            ->and(RegistryFixtures::alive($session))->toBeFalse()
            ->and(Project::query()->whereKey($project->id)->exists())->toBeTrue();
    });

    it('keeps a draft that was submitted before and reopened: only never-submitted drafts are deleted here', function (): void {
        $draft = orderOf($this->customer, Submitted::class);
        $draft->forceFill(['state' => 'draft'])->save();

        ($this->delete)()->assertRedirectToRoute('account.deletion-scheduled');

        expect(Order::query()->whereKey($draft->id)->exists())->toBeTrue();
    });

    it('sends the scheduled mail before the soft delete, to the account, with the date 30 days on', function (): void {
        Notification::fake();
        $sentBeforeDelete = null;
        $armed = true;
        User::deleting(function (User $user) use (&$sentBeforeDelete, &$armed): void {
            if ($armed) {
                $sentBeforeDelete = Notification::sent($user, DeletionScheduled::class)->count();
            }
        });

        ($this->delete)();
        $armed = false;

        expect($sentBeforeDelete)->toBe(1);
        Notification::assertSentTo(
            $this->customer,
            DeletionScheduled::class,
            fn (DeletionScheduled $notification, array $channels): bool => $channels === ['mail']
                && $notification->anonymiseOn->between(now()->addDays(30)->subMinute(), now()->addDays(30)->addMinute()),
        );
    });

    it('words the mail with the date and the business address', function (): void {
        $date = now()->setTimezone('Asia/Kolkata')->addDays(30);
        $mail = (new DeletionScheduled($date))->toMail($this->customer);

        $text = implode("\n", [$mail->subject, ...$mail->introLines]);
        expect($mail->subject)->toBe(trans_icu('notifications.account.deletion_scheduled.customer.title'))
            ->and($text)->toContain($date->format('d M Y'))
            ->and($text)->toContain((string) config('mail.from.address'));
    });

    it('does not mail a customer who has no email', function (): void {
        $phoneOnly = User::factory()->phoneOnly()->create();

        expect((new DeletionScheduled(now()->addDays(30)))->via($phoneOnly))->toBe([]);
    });

    it('lets a phone-only customer go', function (): void {
        $phoneOnly = User::factory()->phoneOnly()->create();

        $this->actingAs($phoneOnly)->withSession(SessionStamp::loginHoursAgo(0))
            ->deleteJson(route('customer.account.destroy'), ['confirmation' => 'DELETE'])
            ->assertRedirectToRoute('account.deletion-scheduled');

        expect(User::withTrashed()->findOrFail($phoneOnly->id)->trashed())->toBeTrue();
    });

    it('audits account.deletion_requested with the customer as causer', function (): void {
        ($this->delete)();

        $activity = Activity::query()->where('event', 'account.deletion_requested')->sole();
        expect($activity->log_name)->toBe('security')
            ->and($activity->subject_id)->toBe($this->customer->id)
            ->and($activity->causer_id)->toBe($this->customer->id);
        // The audit log holds ids and masked values only.
        expect($activity->properties->toJson())->not->toContain('asha@example.com');
    });

    it('accepts the confirmation word in any case, around spaces', function (): void {
        ($this->delete)(' delete ')->assertRedirectToRoute('account.deletion-scheduled');
    });

    it('refuses a wrong or missing confirmation word', function (string $word): void {
        Notification::fake();

        ($this->delete)($word)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['confirmation' => trans_icu('account.errors.confirmation', ['word' => trans_icu('account.delete_word')])]);

        expect(User::query()->find($this->customer->id))->not->toBeNull();
        Notification::assertNothingSent();
    })->with(['', 'delet', 'DELETE ME', 'yes']);

    it('needs a recent authentication', function (): void {
        $this->actingAs($this->customer)
            ->delete(route('customer.account.destroy'), ['confirmation' => 'DELETE'])
            ->assertRedirectToRoute('password.confirm');

        expect(User::query()->find($this->customer->id))->not->toBeNull();
    });

    it('is not for staff', function (): void {
        $staff = User::factory()->owner()->create();

        $this->actingAs($staff)->delete(route('customer.account.destroy'), ['confirmation' => 'DELETE'])->assertRedirectToRoute('admin.dashboard');
        $this->actingAs($staff)->get(route('customer.account.delete'))->assertRedirectToRoute('admin.dashboard');

        expect(User::query()->find($staff->id))->not->toBeNull();
    });

    it('runs every registered step with the user, while the account is still active', function (): void {
        $step = new class implements AccountDeletionStep
        {
            /** @var list<array{id: string, trashed: bool}> */
            public array $calls = [];

            public function handle(User $user): void
            {
                $this->calls[] = ['id' => (string) $user->getKey(), 'trashed' => $user->trashed()];
            }
        };
        app()->instance('test.deletion-step', $step);
        app()->tag('test.deletion-step', 'account.deletion_steps');

        ($this->delete)()->assertRedirectToRoute('account.deletion-scheduled');

        expect($step->calls)->toBe([['id' => $this->customer->id, 'trashed' => false]]);
    });

    it('registers the draft-order step of the foundation under the tag', function (): void {
        $steps = iterator_to_array(app()->tagged('account.deletion_steps'), false);

        expect(array_map(static fn (object $step): string => $step::class, $steps))
            ->toContain(DeleteNeverSubmittedDraftOrders::class);
    });

    it('undoes everything when a step fails: no deletion, no mail', function (): void {
        Notification::fake();
        $project = Project::factory()->forCustomer($this->customer)->create();
        $draft = Order::factory()->state(['project_id' => $project->id])->create();
        $failing = new class implements AccountDeletionStep
        {
            public function handle(User $user): void
            {
                throw new RuntimeException('cancel the import failed');
            }
        };
        app()->instance('test.failing-step', $failing);
        app()->tag('test.failing-step', 'account.deletion_steps');

        expect(fn () => $this->withoutExceptionHandling()->actingAs($this->customer)->withSession(SessionStamp::loginHoursAgo(0))
            ->delete(route('customer.account.destroy'), ['confirmation' => 'DELETE']))->toThrow(RuntimeException::class);

        expect(User::query()->find($this->customer->id))->not->toBeNull()
            ->and(Order::query()->whereKey($draft->id)->exists())->toBeTrue();
        Notification::assertNothingSent();
    });

    it('cannot sign in afterwards', function (): void {
        ($this->delete)();
        $this->flushSession();

        $this->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password'])
            ->assertSessionHasErrors(['email' => __('auth.failed')]);

        $this->assertGuest();
    });
});

describe('the confirmation page', function (): void {
    it('shows the anonymisation date once and the support email', function (): void {
        $this->withSession(['anonymiseOn' => '2026-11-21'])->get(route('account.deletion-scheduled'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/AccountDeletionScheduled')
                ->where('anonymiseOn', '2026-11-21')
                ->where('supportEmail', (string) config('mail.from.address')));
    });

    it('has no date when opened directly, and is open to everybody', function (): void {
        $this->get(route('account.deletion-scheduled'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('anonymiseOn', null));
    });
});
