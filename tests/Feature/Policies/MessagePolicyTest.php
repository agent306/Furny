<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\Cancelled;
use App\Domain\Orders\States\Closed;
use App\Domain\Orders\States\InProduction;
use App\Domain\Orders\States\Submitted;
use App\Domain\Projects\Models\Project;
use App\Policies\MessagePolicy;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Gate;
use Tests\Support\PolicyActors;

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2030-06-15 12:00:00', 'UTC'));
});

it('is found by policy auto-discovery', function (): void {
    expect(Gate::getPolicyFor(Message::class))->toBeInstanceOf(MessagePolicy::class);
});

it('shows the thread to the order\'s customer and to staff with orders.view', function (string $actor, bool|int|null $expected): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $user = PolicyActors::resolve($actor, $order->customer);

    $response = Gate::forUser($user)->inspect('viewThread', [Message::class, $order]);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

describe('create', function (): void {
    it('lets the order\'s verified customer and staff with messages.post write', function (string $actor, bool|int|null $expected): void {
        $order = Order::factory()->inState(InProduction::class)->create();
        $user = PolicyActors::resolve($actor, $order->customer);

        $response = Gate::forUser($user)->inspect('create', [Message::class, $order]);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

    it('denies an unverified customer with 403 contact_unverified and a verified one passes', function (): void {
        $unverified = User::factory()->unverified()->create();
        $order = Order::factory()->inState(Submitted::class)->for(Project::factory()->forCustomer($unverified), 'project')->create();

        $response = Gate::forUser($unverified)->inspect('create', [Message::class, $order]);

        expect([$response->allowed(), $response->status(), $response->code()])->toBe([false, 403, 'contact_unverified'])
            ->and($response->message())->toBe(trans_icu('common.verify_required'))
            ->and(Gate::forUser($order->customer->forceFill(['email_verified_at' => now()]))->allows('create', [Message::class, $order]))->toBeTrue();
    });

    it('hides the order from an unverified stranger', function (): void {
        $order = Order::factory()->inState(Submitted::class)->create();

        $response = Gate::forUser(User::factory()->unverified()->create())->inspect('create', [Message::class, $order]);

        expect([$response->allowed(), $response->status(), $response->code()])->toBe([false, 404, null]);
    });

    describe('thread_closed', function (): void {
        it('allows writing to an order closed or cancelled 89 days ago and refuses 91 days ago with 422', function (string $stateClass, string $column): void {
            $recent = Order::factory()->inState($stateClass)->state([$column => CarbonImmutable::now()->subDays(89)])->create();
            $old = Order::factory()->inState($stateClass)->state([$column => CarbonImmutable::now()->subDays(91)])->create();

            expect(Gate::forUser($recent->customer)->allows('create', [Message::class, $recent]))->toBeTrue();

            $response = Gate::forUser($old->customer)->inspect('create', [Message::class, $old]);

            expect([$response->allowed(), $response->status(), $response->code()])->toBe([false, 422, 'thread_closed'])
                ->and($response->message())->toBe(trans_icu('messages.errors.thread_closed'))
                ->and($response->message())->not->toBe('messages.errors.thread_closed');
        })->with([
            'closed' => [Closed::class, 'closed_at'],
            'cancelled' => [Cancelled::class, 'cancelled_at'],
        ]);

        it('closes the thread only once the 90 days have passed', function (): void {
            $onTheDay = Order::factory()->inState(Closed::class)->state(['closed_at' => CarbonImmutable::now()->subDays(90)])->create();
            $aSecondLater = Order::factory()->inState(Closed::class)->state(['closed_at' => CarbonImmutable::now()->subDays(90)->subSecond()])->create();

            expect(Gate::forUser($onTheDay->customer)->allows('create', [Message::class, $onTheDay]))->toBeTrue()
                ->and(Gate::forUser($aSecondLater->customer)->inspect('create', [Message::class, $aSecondLater])->status())->toBe(422);
        });

        it('applies to staff replies too, but not to internal notes', function (): void {
            $order = Order::factory()->inState(Closed::class)->state(['closed_at' => CarbonImmutable::now()->subDays(91)])->create();
            $gate = Gate::forUser(User::factory()->support()->create());

            expect($gate->inspect('create', [Message::class, $order])->code())->toBe('thread_closed')
                ->and($gate->allows('createInternalNote', [Message::class, $order]))->toBeTrue()
                ->and($gate->allows('viewThread', [Message::class, $order]))->toBeTrue();
        });

        it('fails closed for a closed or cancelled order whose timestamp is missing', function (string $stateClass): void {
            $order = Order::factory()->inState($stateClass)->state(['closed_at' => null, 'cancelled_at' => null])->create();

            $response = Gate::forUser($order->customer)->inspect('create', [Message::class, $order]);

            expect([$response->allowed(), $response->status(), $response->code()])->toBe([false, 422, 'thread_closed']);
        })->with([
            'closed' => Closed::class,
            'cancelled' => Cancelled::class,
        ]);

        it('is decided after ownership and before the verification of the contact', function (): void {
            $unverified = User::factory()->unverified()->create();
            $order = Order::factory()->inState(Closed::class)->state(['closed_at' => CarbonImmutable::now()->subDays(91)])
                ->for(Project::factory()->forCustomer($unverified), 'project')->create();

            expect(Gate::forUser($unverified)->inspect('create', [Message::class, $order])->code())->toBe('thread_closed')
                ->and(Gate::forUser(User::factory()->create())->inspect('create', [Message::class, $order])->status())->toBe(404);
        });
    });
});

it('lets only staff with messages.post write internal notes', function (string $actor, bool|int|null $expected): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $user = PolicyActors::resolve($actor, $order->customer);

    $response = Gate::forUser($user)->inspect('createInternalNote', [Message::class, $order]);

    expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::staffOnly(PolicyActors::STAFF)));

describe('update and delete', function (): void {
    it('let the author change their text message under 10 minutes old', function (string $ability, int $secondsOld, bool $allowed): void {
        $message = Message::factory()->state(['created_at' => CarbonImmutable::now()->subSeconds($secondsOld)])->create();

        $response = Gate::forUser($message->order->customer)->inspect($ability, $message);

        expect($response->allowed())->toBe($allowed);

        if (! $allowed) {
            expect([$response->status(), $response->code()])->toBe([422, 'edit_window'])
                ->and($response->message())->toBe(trans_icu('messages.errors.edit_window'))
                ->and($response->message())->not->toBe('messages.errors.edit_window');
        }
    })->with(function (): iterable {
        foreach (['update', 'delete'] as $ability) {
            yield "{$ability} / 9 min" => [$ability, 9 * 60, true];
            yield "{$ability} / 9:59" => [$ability, 9 * 60 + 59, true];
            yield "{$ability} / exactly 10:00" => [$ability, 10 * 60, false];
            yield "{$ability} / 11 min" => [$ability, 11 * 60, false];
        }
    });

    it('let a staff author change their reply', function (): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $support = User::factory()->support()->create();
        $message = Message::factory()->by($support)->for($order)->state(['created_at' => CarbonImmutable::now()->subMinutes(5)])->create();

        expect(Gate::forUser($support)->allows('update', $message))->toBeTrue()
            ->and(Gate::forUser($support)->allows('delete', $message))->toBeTrue();
    });

    it('refuse anybody but the author', function (string $ability, string $actor, bool|int|null $expected): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $message = Message::factory()->by(User::factory()->estimator()->create())->for($order)->create();
        $user = PolicyActors::resolve($actor, $order->customer);

        $response = Gate::forUser($user)->inspect($ability, $message);

        expect([$response->allowed(), $response->status()])->toBe(PolicyActors::outcome($expected));
    })->with(function (): iterable {
        $expectations = PolicyActors::ownerOrStaff([]);
        // The estimator wrote it, so the order's customer and the other staff are refused with 403 and a stranger with 404.
        $expectations['customer'] = 403;

        foreach (['update', 'delete'] as $ability) {
            foreach ($expectations as $actor => $expected) {
                yield "{$ability} / {$actor}" => [$ability, $actor, $expected];
            }
        }
    });

    it('refuse system messages and internal notes, even to their author', function (string $ability): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $staff = User::factory()->admin()->create();
        $system = Message::factory()->for($order)->system()->state(['author_id' => $order->customer_id])->create();
        $note = Message::factory()->for($order)->internalNote()->state(['author_id' => $staff->id])->create();

        $bySystem = Gate::forUser($order->customer)->inspect($ability, $system);
        $byNote = Gate::forUser($staff)->inspect($ability, $note);

        expect([$bySystem->allowed(), $bySystem->status()])->toBe([false, 403])
            ->and([$byNote->allowed(), $byNote->status()])->toBe([false, 403]);
    })->with(['update', 'delete']);

    it('refuse a staff author who lost messages.post', function (): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $former = User::factory()->production()->create();
        $message = Message::factory()->by($former)->for($order)->create();
        $former->syncRoles([]);

        $response = Gate::forUser($former)->inspect('update', $message);

        expect([$response->allowed(), $response->status()])->toBe([false, 403]);
    });

    it('refuse an inactive staff author', function (): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $admin = User::factory()->admin()->inactive()->create();
        $message = Message::factory()->by($admin)->for($order)->create();

        $response = Gate::forUser($admin)->inspect('update', $message);

        expect([$response->allowed(), $response->status()])->toBe([false, null]);
    });
});

it('gives a customer holding a staff role no staff ability on other customers\' threads', function (): void {
    $customer = User::factory()->create();
    $customer->assignRole('owner');
    $order = Order::factory()->inState(Submitted::class)->create();

    foreach (['viewThread', 'create', 'createInternalNote'] as $ability) {
        $arguments = [Message::class, $order];

        expect(Gate::forUser($customer)->inspect($ability, $arguments)->status())->toBe(404, $ability);
    }

    $own = Order::factory()->inState(Submitted::class)->for(Project::factory()->forCustomer($customer), 'project')->create();

    expect(Gate::forUser($customer)->inspect('createInternalNote', [Message::class, $own])->status())->toBe(403);
});

describe('on a soft-deleted order', function (): void {
    it('still serves the customer\'s thread and edits, and hides it from strangers', function (): void {
        $order = Order::factory()->inState(Submitted::class)->create();
        $message = Message::factory()->for($order)->state(['created_at' => CarbonImmutable::now()->subMinutes(2)])->create();
        $customer = $order->customer;
        $order->delete();
        $fresh = Message::query()->findOrFail($message->id);

        expect(Gate::forUser($customer)->allows('viewThread', [Message::class, $order]))->toBeTrue()
            ->and(Gate::forUser($customer)->allows('update', $fresh))->toBeTrue()
            ->and(Gate::forUser($customer)->allows('delete', $fresh))->toBeTrue()
            ->and(Gate::forUser(User::factory()->create())->inspect('update', $fresh)->status())->toBe(404)
            ->and(Gate::forUser(User::factory()->create())->inspect('viewThread', [Message::class, $order])->status())->toBe(404);
    });
});

it('never lets a user whose type is staff own an order, whatever the order\'s customer_id says', function (): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $message = Message::factory()->for($order)->create();
    $formerCustomer = $order->customer;
    $formerCustomer->forceFill(['type' => UserType::Staff])->save();
    $gate = Gate::forUser($formerCustomer->fresh());

    expect($gate->allows('viewThread', [Message::class, $order]))->toBeFalse()
        ->and($gate->allows('create', [Message::class, $order]))->toBeFalse()
        ->and($gate->allows('update', $message))->toBeFalse();
});
