<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Actions\AnonymiseUser;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\NotificationDelivery;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\ConfirmationCall;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Http\CodedValidationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\AccountDataFixture;
use Tests\Support\RegistryFixtures;

beforeEach(function (): void {
    Storage::fake('s3');
    Storage::fake('s3-public');
});

afterEach(function (): void {
    RegistryFixtures::clean(...($this->users ?? []));
});

/** Runs the scheduled anonymisation of the fixture's customer and returns the refreshed user. */
function anonymised(AccountDataFixture $fixture, string $via = 'scheduler'): User
{
    app(AnonymiseUser::class)->handle($fixture->user, $via);

    return User::withTrashed()->findOrFail($fixture->user->id);
}

it('replaces the identity and clears every personal column of 02 §1.1', function (): void {
    $fixture = AccountDataFixture::create();
    $id = (string) $fixture->user->id;

    $user = anonymised($fixture);

    expect($user->name)->toBe('Deleted customer '.substr($id, -6))
        ->and($user->email)->toBe('deleted+'.$id.'@invalid.invalid')
        ->and($user->anonymised_at)->not->toBeNull()
        ->and($user->marketing_opt_in)->toBeFalse()
        ->and($user->trashed())->toBeTrue();
});

it('clears each of the nullable personal columns', function (string $column): void {
    $fixture = AccountDataFixture::create();
    $before = $fixture->user->getRawOriginal($column);
    expect($before)->not->toBeNull("{$column} must be filled in the fixture for this test to prove anything");

    $user = anonymised($fixture);

    expect($user->getRawOriginal($column))->toBeNull();
})->with([
    'phone_e164', 'phone_verified_at', 'email_verified_at', 'first_contact_verified_at', 'password', 'google_id',
    'remember_token', 'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_confirmed_at', 'notes_internal', 'last_login_at',
]);

it('classifies every column of users: a new column fails here until it is judged personal or not', function (): void {
    // 02 §1.1 and 13 §9.2. Cleared or replaced by AnonymiseUser:
    $personal = [
        'name', 'email', 'phone_e164', 'phone_verified_at', 'email_verified_at', 'first_contact_verified_at', 'password',
        'google_id', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_confirmed_at',
        'notes_internal', 'last_login_at', 'marketing_opt_in',
    ];
    // Not personal data, kept: the account's identity in the system, preferences and timestamps.
    $kept = [
        'id', 'type', 'unit_system', 'length_unit', 'locale', 'timezone', 'is_active', 'terms_accepted_at', 'onboarded_at',
        'anonymised_at', 'created_at', 'updated_at', 'deleted_at',
    ];

    expect(Schema::getColumnListing('users'))->toEqualCanonicalizing([...$personal, ...$kept]);

    $fixture = AccountDataFixture::create();
    $before = $fixture->user->getAttributes();
    $after = anonymised($fixture)->getAttributes();

    foreach ($personal as $column) {
        expect($after[$column])->not->toBe($before[$column], "{$column} was left as it was");
    }
});

it('deletes the avatar and the files of the photos and plans it removes', function (): void {
    $fixture = AccountDataFixture::create();
    $files = fn (string $disk): array => Storage::disk($disk)->allFiles();
    expect($files('s3-public'))->not->toBe([])
        ->and(AccountDataFixture::hasMedia('user', $fixture->user->id))->toBeTrue();

    anonymised($fixture);

    expect(AccountDataFixture::hasMedia('user', $fixture->user->id))->toBeFalse()
        ->and($files('s3-public'))->toBe([])
        ->and(AccountDataFixture::hasMedia('plan', $fixture->gonePlan->id))->toBeFalse()
        ->and(AccountDataFixture::hasMedia('plan', $fixture->keptPlan->id))->toBeFalse();
});

it('deletes the addresses no order uses and scrubs the ones an order uses', function (): void {
    $fixture = AccountDataFixture::create();

    anonymised($fixture);

    expect(Address::query()->whereKey($fixture->unusedAddress->id)->exists())->toBeFalse();

    $kept = Address::query()->findOrFail($fixture->orderAddress->id);
    expect($kept->label)->toBe('[removed]')
        ->and($kept->line1)->toBe('[removed]')
        ->and($kept->line2)->toBeNull()
        ->and($kept->latitude)->toBeNull()
        ->and($kept->longitude)->toBeNull()
        ->and($kept->city)->toBe('Bengaluru')
        ->and($kept->region)->toBe('Karnataka')
        ->and($kept->postal_code)->toBe('560001')
        ->and($kept->country_code)->toBe('IN');
});

it('also keeps the address of a soft-deleted order as a business record', function (): void {
    $fixture = AccountDataFixture::create();
    $fixture->order->delete();

    anonymised($fixture);

    expect(Address::query()->findOrFail($fixture->orderAddress->id)->line1)->toBe('[removed]');
});

it('hard-deletes a project without orders with its plans, designs and imports', function (): void {
    $fixture = AccountDataFixture::create();
    // A soft-deleted plan and design are personal data as well.
    Plan::factory()->state(['project_id' => $fixture->goneProject->id])->create(['deleted_at' => now()]);

    anonymised($fixture);

    expect(Project::withTrashed()->whereKey($fixture->goneProject->id)->exists())->toBeFalse()
        ->and(Plan::withTrashed()->where('project_id', $fixture->goneProject->id)->exists())->toBeFalse()
        ->and(FurnitureDesign::withTrashed()->where('project_id', $fixture->goneProject->id)->exists())->toBeFalse()
        ->and(BlueprintImport::query()->where('project_id', $fixture->goneProject->id)->exists())->toBeFalse();
});

it('renames a project with orders, drops its notes, plans and imports, and keeps its designs', function (): void {
    $fixture = AccountDataFixture::create();
    $id = (string) $fixture->keptProject->id;

    anonymised($fixture);

    $project = Project::withTrashed()->findOrFail($id);
    expect($project->name)->toBe('Project '.substr($id, -6))
        ->and($project->notes)->toBeNull()
        ->and(Plan::withTrashed()->where('project_id', $id)->exists())->toBeFalse()
        ->and(BlueprintImport::query()->where('project_id', $id)->exists())->toBeFalse()
        ->and(FurnitureDesign::query()->whereKey($fixture->keptDesign->id)->exists())->toBeTrue();
});

it('deletes the notifications, preferences, phone codes, push subscriptions and uploads of the user', function (): void {
    $fixture = AccountDataFixture::create();
    $id = (string) $fixture->user->id;

    anonymised($fixture);

    expect(DB::table('notifications')->where('notifiable_id', $id)->exists())->toBeFalse()
        ->and(NotificationPreference::query()->where('user_id', $id)->exists())->toBeFalse()
        ->and(OtpCode::query()->where('phone_e164', AccountDataFixture::PHONE)->exists())->toBeFalse()
        ->and(DB::table('push_subscriptions')->where('subscribable_id', $id)->exists())->toBeFalse()
        ->and(UploadIntent::query()->where('user_id', $id)->exists())->toBeFalse()
        ->and(DB::table('password_reset_tokens')->where('email', 'asha.krishnan@example.com')->exists())->toBeFalse();
});

it('detaches the deliveries from the user but keeps their rows', function (): void {
    $fixture = AccountDataFixture::create();

    anonymised($fixture);

    expect(NotificationDelivery::query()->count())->toBe(1)
        ->and(NotificationDelivery::query()->value('user_id'))->toBeNull();
});

it('masks the number of a confirmation call and the address a quote was accepted from', function (): void {
    $fixture = AccountDataFixture::create();

    anonymised($fixture);

    expect(ConfirmationCall::query()->findOrFail($fixture->call->id)->phone_e164)->toBe('+910000000000')
        ->and(Quote::query()->findOrFail($fixture->quote->id)->accepted_by_ip)->toBe('203.0.113.0');
});

it('masks an IPv6 address to its /48', function (): void {
    $fixture = AccountDataFixture::create();
    DB::table('quotes')->where('id', $fixture->quote->id)->update(['accepted_by_ip' => '2001:db8:1234:5678::1']);

    anonymised($fixture);

    expect(Quote::query()->findOrFail($fixture->quote->id)->accepted_by_ip)->toBe('2001:db8:1234::');
});

it('keeps the orders, quotes and messages that reference the user', function (): void {
    $fixture = AccountDataFixture::create();

    anonymised($fixture);

    expect(Order::query()->whereKey($fixture->order->id)->value('customer_id'))->toBe($fixture->user->id)
        ->and(Quote::query()->whereKey($fixture->quote->id)->exists())->toBeTrue()
        ->and(Message::query()->whereKey($fixture->message->id)->value('author_id'))->toBe($fixture->user->id)
        ->and($fixture->user->aiCreditLedgerEntries()->count())->toBe(1);
});

it('signs out every session of the user and leaves no remember token', function (): void {
    $fixture = AccountDataFixture::create();
    $this->users = [$fixture->user];
    $session = RegistryFixtures::open($fixture->user);
    DB::table('sessions')->insert(['id' => 'db-session', 'user_id' => $fixture->user->id, 'ip_address' => '203.0.113.45', 'user_agent' => 'x', 'payload' => '', 'last_activity' => time()]);

    $user = anonymised($fixture);

    expect(RegistryFixtures::alive($session))->toBeFalse()
        ->and(DB::table('sessions')->where('user_id', $fixture->user->id)->exists())->toBeFalse()
        ->and($user->remember_token)->toBeNull()
        ->and($user->google_id)->toBeNull();
});

it('audits account.anonymised without a causer and with via scheduler', function (): void {
    $fixture = AccountDataFixture::create();

    anonymised($fixture);

    $activity = Activity::query()->where('event', 'account.anonymised')->sole();
    expect($activity->log_name)->toBe('security')
        ->and($activity->subject_id)->toBe($fixture->user->id)
        ->and($activity->causer_id)->toBeNull()
        ->and($activity->properties->all())->toBe(['via' => 'scheduler']);
});

it('puts no personal value in the audit log', function (): void {
    $fixture = AccountDataFixture::create();

    anonymised($fixture);

    $log = Activity::query()->get()->toJson();
    expect($log)->not->toContain('asha.krishnan')->not->toContain('9876543210')->not->toContain('Asha');
});

it('does nothing to an account that was already anonymised', function (): void {
    $fixture = AccountDataFixture::create();
    anonymised($fixture);
    $stamp = User::withTrashed()->findOrFail($fixture->user->id)->anonymised_at;
    $this->travel(1)->hours();

    anonymised($fixture);

    expect(User::withTrashed()->findOrFail($fixture->user->id)->anonymised_at->equalTo($stamp))->toBeTrue()
        ->and(Activity::query()->where('event', 'account.anonymised')->count())->toBe(1);
});

it('never anonymises staff', function (): void {
    $staff = User::factory()->estimator()->create(['deleted_at' => now()->subDays(40)]);

    expect(fn () => app(AnonymiseUser::class)->handle($staff, 'scheduler'))->toThrow(LogicException::class)
        ->and(User::withTrashed()->findOrFail($staff->id)->anonymised_at)->toBeNull();
});

it('rolls everything back when a step fails', function (): void {
    $fixture = AccountDataFixture::create();
    // The failure comes last in the transaction: the user row is written after the deletions.
    $armed = true;
    User::saving(static function () use (&$armed): void {
        if ($armed) {
            throw new RuntimeException('disk full');
        }
    });

    expect(fn () => app(AnonymiseUser::class)->handle($fixture->user, 'scheduler'))->toThrow(RuntimeException::class);

    $armed = false;
    expect(Address::query()->whereKey($fixture->unusedAddress->id)->exists())->toBeTrue()
        ->and(Project::withTrashed()->whereKey($fixture->goneProject->id)->exists())->toBeTrue()
        ->and(User::withTrashed()->findOrFail($fixture->user->id)->anonymised_at)->toBeNull();
});

describe('users:anonymise-deleted', function (): void {
    it('anonymises the customers deleted 30 days ago or more, once, and nobody else', function (): void {
        $expired = AccountDataFixture::create(31);
        $recent = User::factory()->pendingDeletion(29)->create(['name' => 'Recent Rao']);
        $active = User::factory()->create(['name' => 'Active Anand']);
        $staff = User::factory()->estimator()->create(['deleted_at' => now()->subDays(60)]);
        $done = User::factory()->anonymised()->create();

        $this->artisan('users:anonymise-deleted')->assertSuccessful()->expectsOutputToContain('1');

        expect(User::withTrashed()->findOrFail($expired->user->id)->anonymised_at)->not->toBeNull()
            ->and(User::withTrashed()->findOrFail($recent->id)->name)->toBe('Recent Rao')
            ->and(User::withTrashed()->findOrFail($recent->id)->anonymised_at)->toBeNull()
            ->and(User::query()->findOrFail($active->id)->name)->toBe('Active Anand')
            ->and(User::withTrashed()->findOrFail($staff->id)->anonymised_at)->toBeNull()
            ->and(Activity::query()->where('event', 'account.anonymised')->count())->toBe(1)
            ->and($done->anonymised_at)->not->toBeNull();
    });

    it('anonymises on the 30th day exactly', function (): void {
        $user = User::factory()->pendingDeletion(30)->create();

        $this->artisan('users:anonymise-deleted')->assertSuccessful();

        expect(User::withTrashed()->findOrFail($user->id)->anonymised_at)->not->toBeNull();
    });

    it('goes on with the next customer when one fails, and fails the run', function (): void {
        $first = User::factory()->deletionExpired()->create();
        $second = User::factory()->deletionExpired()->create();

        // The failure is in the first customer's own row, which is written last in its transaction.
        $armed = true;
        User::saving(static function (User $user) use ($first, &$armed): void {
            if ($armed && $user->is($first) && $user->anonymised_at !== null) {
                throw new RuntimeException('boom');
            }
        });

        $this->artisan('users:anonymise-deleted')->assertFailed();
        $armed = false;

        expect(User::withTrashed()->findOrFail($second->id)->anonymised_at)->not->toBeNull()
            ->and(User::withTrashed()->findOrFail($first->id)->anonymised_at)->toBeNull();
    });
});

describe('immediate anonymisation by an owner', function (): void {
    it('anonymises a customer who is not deleted yet, deleting them first', function (): void {
        $fixture = AccountDataFixture::create(null);
        $owner = User::factory()->owner()->create();
        $fixture->order->forceFill(['state' => 'closed'])->save();

        app(AnonymiseUser::class)->handle($fixture->user, 'admin', $owner);

        $user = User::withTrashed()->findOrFail($fixture->user->id);
        expect($user->trashed())->toBeTrue()
            ->and($user->anonymised_at)->not->toBeNull()
            ->and($user->email)->toBe('deleted+'.$user->id.'@invalid.invalid');

        $activity = Activity::query()->where('event', 'account.anonymised')->sole();
        expect($activity->causer_id)->toBe($owner->id)->and($activity->properties->all())->toBe(['via' => 'admin']);
    });

    it('refuses while the customer has an Active order and changes nothing', function (): void {
        $fixture = AccountDataFixture::create(null);
        $owner = User::factory()->owner()->create();

        expect(fn () => app(AnonymiseUser::class)->handle($fixture->user, 'admin', $owner))
            ->toThrow(CodedValidationException::class);

        expect(User::query()->findOrFail($fixture->user->id)->anonymised_at)->toBeNull()
            ->and(Address::query()->whereKey($fixture->unusedAddress->id)->exists())->toBeTrue();
    });
});
