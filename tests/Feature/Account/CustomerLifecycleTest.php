<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\Accepted;
use App\Domain\Orders\States\Closed;
use App\Domain\Projects\Models\Project;
use Illuminate\Support\Facades\Storage;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\AccountDataFixture;
use Tests\Support\RegistryFixtures;

beforeEach(function (): void {
    Storage::fake('s3');
    Storage::fake('s3-public');
    $this->owner = User::factory()->owner()->create();
    $this->admin = User::factory()->admin()->create();
    $this->estimator = User::factory()->estimator()->create();
    $this->customer = User::factory()->pendingDeletion(5)->create(['email' => 'asha@example.com']);
});

afterEach(function (): void {
    RegistryFixtures::clean($this->customer);
});

it('has the routes of 14 §9', function (): void {
    expect(route('admin.customers.restore', ['user' => $this->customer], absolute: false))->toBe('/admin/customers/'.$this->customer->id.'/restore')
        ->and(route('admin.customers.anonymise', ['user' => $this->customer], absolute: false))->toBe('/admin/customers/'.$this->customer->id.'/anonymise');
});

describe('restoring', function (): void {
    it('brings back an account deleted less than 30 days ago and audits it', function (): void {
        $this->actingAs($this->admin)->post(route('admin.customers.restore', $this->customer))->assertRedirect();

        expect(User::query()->find($this->customer->id))->not->toBeNull();

        $activity = Activity::query()->where('event', 'account.deletion_cancelled')->sole();
        expect($activity->log_name)->toBe('security')
            ->and($activity->subject_id)->toBe($this->customer->id)
            ->and($activity->causer_id)->toBe($this->admin->id)
            ->and($activity->properties->all())->toBe(['via' => 'admin']);
    });

    it('lets the customer sign in again', function (): void {
        $this->actingAs($this->owner)->post(route('admin.customers.restore', $this->customer));
        $this->flushSession();
        auth()->forgetGuards();

        $this->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password'])->assertSessionHasNoErrors();

        $this->assertAuthenticatedAs($this->customer);
    });

    it('is for staff who manage customers: an estimator gets 403', function (): void {
        $this->actingAs($this->estimator)->post(route('admin.customers.restore', $this->customer))->assertForbidden();

        expect(User::query()->find($this->customer->id))->toBeNull();
    });

    it('is not for customers', function (): void {
        $this->actingAs(User::factory()->create())->post(route('admin.customers.restore', $this->customer))->assertForbidden();
    });

    it('refuses after the 30 days', function (): void {
        $late = User::factory()->pendingDeletion(31)->create();

        $this->actingAs($this->admin)->postJson(route('admin.customers.restore', $late))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'restore_window_passed');

        expect(User::query()->find($late->id))->toBeNull();
    });

    it('refuses an anonymised account, even inside the window', function (): void {
        $gone = User::factory()->anonymised()->create(['deleted_at' => now()->subDays(2)]);

        $this->actingAs($this->admin)->postJson(route('admin.customers.restore', $gone))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'restore_window_passed');
    });

    it('is a 404 for a customer who is not deleted and for staff', function (): void {
        $active = User::factory()->create();

        $this->actingAs($this->admin)->post(route('admin.customers.restore', $active))->assertNotFound();
        $this->actingAs($this->admin)->post(route('admin.customers.restore', $this->estimator))->assertNotFound();
    });
});

describe('anonymising at once', function (): void {
    it('is for the owner only: an admin gets 403', function (): void {
        $this->actingAs($this->admin)->post(route('admin.customers.anonymise', $this->customer), ['confirmation' => 'ANONYMISE'])->assertForbidden();

        expect(User::withTrashed()->findOrFail($this->customer->id)->anonymised_at)->toBeNull();
    });

    it('lets an owner anonymise without waiting for the 30 days, and lands on the dashboard until the customer list exists', function (): void {
        $this->actingAs($this->owner)
            ->post(route('admin.customers.anonymise', $this->customer), ['confirmation' => 'ANONYMISE'])
            ->assertRedirectToRoute('admin.dashboard');

        $user = User::withTrashed()->findOrFail($this->customer->id);
        expect($user->anonymised_at)->not->toBeNull()->and($user->email)->toBe('deleted+'.$user->id.'@invalid.invalid');

        $activity = Activity::query()->where('event', 'account.anonymised')->sole();
        expect($activity->causer_id)->toBe($this->owner->id)->and($activity->properties->all())->toBe(['via' => 'admin']);
    });

    it('anonymises a customer who never asked to be deleted', function (): void {
        $fixture = AccountDataFixture::create(null);
        Order::query()->whereKey($fixture->order->id)->update(['state' => 'closed']);

        $this->actingAs($this->owner)
            ->post(route('admin.customers.anonymise', $fixture->user), ['confirmation' => 'ANONYMISE'])
            ->assertRedirectToRoute('admin.dashboard');

        expect(User::withTrashed()->findOrFail($fixture->user->id)->anonymised_at)->not->toBeNull();
    });

    it('refuses with the code active_orders while the customer has an Active order', function (): void {
        $project = Project::factory()->forCustomer($this->customer)->create();
        Order::factory()->state(['project_id' => $project->id])->inState(Accepted::class)->create();

        $this->actingAs($this->owner)
            ->postJson(route('admin.customers.anonymise', $this->customer), ['confirmation' => 'ANONYMISE'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'active_orders');

        expect(User::withTrashed()->findOrFail($this->customer->id)->anonymised_at)->toBeNull();
    });

    it('goes ahead when the orders are finished', function (): void {
        $project = Project::factory()->forCustomer($this->customer)->create();
        Order::factory()->state(['project_id' => $project->id])->inState(Closed::class)->create();

        $this->actingAs($this->owner)
            ->post(route('admin.customers.anonymise', $this->customer), ['confirmation' => 'ANONYMISE'])
            ->assertRedirectToRoute('admin.dashboard');
    });

    it('wants the word ANONYMISE', function (string $word): void {
        $this->actingAs($this->owner)
            ->postJson(route('admin.customers.anonymise', $this->customer), ['confirmation' => $word])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('confirmation');

        expect(User::withTrashed()->findOrFail($this->customer->id)->anonymised_at)->toBeNull();
    })->with(['', 'anonymise', 'DELETE']);

    it('is a 404 for staff', function (): void {
        $this->actingAs($this->owner)
            ->post(route('admin.customers.anonymise', $this->estimator), ['confirmation' => 'ANONYMISE'])
            ->assertNotFound();

        expect($this->estimator->fresh()->anonymised_at)->toBeNull();
    });
});
