<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\OwnerGate;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\States\Accepted;
use App\Domain\Orders\States\Submitted;
use App\Domain\Settings\Models\BusinessProfile;
use App\Http\Middleware\HandleInertiaRequests;
use App\Support\Features;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Inertia;

beforeEach(function (): void {
    Route::middleware('web')->get('/_props', fn () => Inertia::render('Welcome'));
});

/**
 * The props of `/_props` as the browser's Inertia client would receive them. `$only` makes it a
 * partial reload of those props (lazy `Inertia::optional` props resolve only then).
 *
 * @param  list<string>  $only
 * @param  array<string, mixed>  $session
 * @return array<string, mixed>
 */
function sharedProps(?User $user = null, array $only = [], array $session = []): array
{
    $headers = ['X-Inertia' => 'true', 'X-Inertia-Version' => (string) app(HandleInertiaRequests::class)->version(request())];

    if ($only !== []) {
        $headers += ['X-Inertia-Partial-Component' => 'Welcome', 'X-Inertia-Partial-Data' => implode(',', $only)];
    }

    $test = test();

    if ($user !== null) {
        $test = $test->actingAs($user);
    }

    return $test->withSession($session)->withHeaders($headers)->get('/_props')->assertOk()->json('props');
}

/** The first (HTML) load: the escaped JSON in `data-page`, decoded again. */
function firstLoadPage(?User $user = null): TestResponse
{
    $test = test();

    return ($user !== null ? $test->actingAs($user) : $test)->get('/_props')->assertOk();
}

const AUTH_USER_KEYS = [
    'id', 'type', 'name', 'email', 'emailVerified', 'phoneE164', 'phoneVerified', 'avatarUrl', 'roles',
    'permissions', 'abilities', 'unitSystem', 'lengthUnit', 'timezone', 'locale', 'onboarded', 'hasPassword', 'twoFactorEnabled',
];

it('shares the guest props and nothing that needs a signed-in user', function (): void {
    $props = sharedProps();

    expect($props['auth'])->toBe(['user' => null])
        ->and($props)->not->toHaveKey('unreadNotifications')
        ->and($props)->not->toHaveKey('staffCounters')
        ->and($props)->not->toHaveKey('healthBanners')
        ->and(array_keys($props['features']))->toBe(['payments', 'whatsapp', 'sms', 'web_push', 'google_login', 'dxf_import', 'walkthrough_camera', 'captcha'])
        ->and($props['features'])->toBe(Features::all())
        ->and($props['app'])->toBe(['name' => config('app.name'), 'logoUrl' => null, 'version' => config('app.version')])
        ->and($props['app']['version'])->toBe(config('app.version'))
        ->and($props['flash'])->toBe(['success' => null, 'error' => null, 'info' => null, 'warning' => null]);
});

it('shares the i18n locale and the manifest hash of that locale', function (): void {
    $manifest = json_decode((string) file_get_contents(resource_path('js/lang/generated/manifest.json')), true, flags: JSON_THROW_ON_ERROR);

    expect(sharedProps()['i18n'])->toBe(['locale' => 'en', 'hash' => $manifest['en']]);
});

it('falls back to the english hash for a locale without a catalogue', function (): void {
    $manifest = json_decode((string) file_get_contents(resource_path('js/lang/generated/manifest.json')), true, flags: JSON_THROW_ON_ERROR);
    app()->setLocale('xx');

    expect(sharedProps()['i18n'])->toBe(['locale' => 'en', 'hash' => $manifest['en']]);
});

it('shares exactly the public business keys', function (): void {
    $business = sharedProps()['business'];

    expect(array_keys($business))->toBe(['name', 'currency', 'locale', 'timezone', 'phoneE164', 'email', 'workingHours', 'units', 'defaultCountryCode'])
        ->and($business['units'])->toBe(['defaultSystem' => 'metric', 'defaultLengthUnit' => 'mm'])
        ->and($business['currency'])->toBe('INR')
        ->and($business['locale'])->toBe('en-IN')
        ->and($business['timezone'])->toBe('Asia/Kolkata')
        ->and($business['defaultCountryCode'])->toBe('IN');
});

it('takes the default country from the business address', function (): void {
    $settings = app(Settings::class);
    $business = $settings->business();
    $business->address = ['line1' => '1 Main Road', 'country_code' => 'AE'];
    $settings->put(SettingsGroup::Business, $business);

    expect(sharedProps()['business']['defaultCountryCode'])->toBe('AE');
});

it('exposes no internal setting to guests', function (): void {
    $settings = app(Settings::class);
    $business = $settings->business();
    $business->taxId = 'GSTIN-SECRET-77';
    $business->legalName = 'Legal Name Pvt Ltd';
    $business->quoteTerms = 'Internal quote terms text';
    $settings->put(SettingsGroup::Business, $business);

    $json = json_encode(firstLoadPage()->viewData('page'), JSON_THROW_ON_ERROR);

    foreach (['GSTIN-SECRET-77', 'Legal Name Pvt Ltd', 'Internal quote terms text', 'taxId', 'legalName', 'quoteTerms', 'otpAllowedCountryCodes', 'apiKey'] as $needle) {
        expect($json)->not->toContain($needle);
    }
});

it('shares the logo url of the business logo', function (): void {
    $media = BusinessProfile::instance()->addMedia(UploadedFile::fake()->image('logo.png', 200, 200))->toMediaCollection('logo');
    $settings = app(Settings::class);
    $business = $settings->business();
    $business->logoMediaId = $media->id;
    $settings->put(SettingsGroup::Business, $business);

    expect(sharedProps()['app']['logoUrl'])->toBe($media->getUrl());
});

it('shares the exact 18 auth user fields for a customer, with empty lists', function (): void {
    $customer = User::factory()->emailVerified()->create(['name' => 'Asha Rao', 'email' => 'asha@example.test']);

    $user = sharedProps($customer)['auth']['user'];

    expect(array_keys($user))->toEqualCanonicalizing(AUTH_USER_KEYS)
        ->and($user)->toHaveCount(18)
        ->and($user['id'])->toBe($customer->id)
        ->and($user['type'])->toBe('customer')
        ->and($user['name'])->toBe('Asha Rao')
        ->and($user['email'])->toBe('asha@example.test')
        ->and($user['emailVerified'])->toBeTrue()
        ->and($user['roles'])->toBe([])
        ->and($user['permissions'])->toBe([])
        ->and($user['abilities'])->toBe([])
        ->and($user['unitSystem'])->toBe('metric')
        ->and($user['hasPassword'])->toBeTrue()
        ->and($user['twoFactorEnabled'])->toBeFalse();
});

it('reports a not yet onboarded customer and a phone-only account', function (): void {
    $user = sharedProps(User::factory()->phoneOnly()->phoneVerified()->notOnboarded()->passwordless()->create())['auth']['user'];

    expect($user['email'])->toBeNull()
        ->and($user['emailVerified'])->toBeFalse()
        ->and($user['phoneVerified'])->toBeTrue()
        ->and($user['phoneE164'])->toStartWith('+')
        ->and($user['onboarded'])->toBeFalse()
        ->and($user['hasPassword'])->toBeFalse();
});

it('reports two-factor and imperial preferences', function (): void {
    $user = sharedProps(User::factory()->imperial()->withTwoFactor()->create())['auth']['user'];

    expect($user['twoFactorEnabled'])->toBeTrue()
        ->and($user['unitSystem'])->toBe('imperial');
});

it('shares the avatar thumbnail url when the user has an avatar', function (): void {
    $customer = User::factory()->create();
    $customer->addMedia(UploadedFile::fake()->image('me.png', 300, 300))->toMediaCollection('avatar');

    expect(sharedProps($customer)['auth']['user']['avatarUrl'])->toBeString()->toContain('me');
});

it('shares an admin with 24 permissions, a role and no owner abilities', function (): void {
    $user = sharedProps(User::factory()->admin()->create())['auth']['user'];

    expect($user['type'])->toBe('staff')
        ->and($user['roles'])->toBe(['admin'])
        ->and($user['permissions'])->toHaveCount(24)
        ->and($user['permissions'])->toEqual(collect(PermissionName::cases())->map->value->sort()->values()->all())
        ->and($user['abilities'])->toBe([])
        ->and($user['onboarded'])->toBeTrue();
});

it('shares the five owner gates as abilities of an owner', function (): void {
    $user = sharedProps(User::factory()->owner()->create())['auth']['user'];

    expect($user['roles'])->toBe(['owner'])
        ->and($user['abilities'])->toEqualCanonicalizing(array_map(static fn (OwnerGate $gate): string => $gate->value, OwnerGate::cases()))
        ->and($user['abilities'])->toHaveCount(5);
});

it('shares narrower permissions for narrower roles', function (): void {
    $user = sharedProps(User::factory()->production()->create())['auth']['user'];

    expect($user['permissions'])->toContain('production.manage')
        ->and($user['permissions'])->not->toContain('settings.manage')
        ->and($user['abilities'])->toBe([]);
});

it('shares no roles, permissions or abilities for inactive staff, matching Gate::before', function (): void {
    $owner = User::factory()->owner()->inactive()->create();

    $user = sharedProps($owner)['auth']['user'];

    expect($user['type'])->toBe('staff')
        ->and($user['roles'])->toBe([])
        ->and($user['permissions'])->toBe([])
        ->and($user['abilities'])->toBe([])
        ->and($owner->can('settings.manage'))->toBeFalse()
        ->and($owner->can(OwnerGate::DataDelete->value))->toBeFalse();
});

it('shares no permissions for a customer that was given a role or permission by mistake', function (): void {
    $customer = User::factory()->create();
    $customer->givePermissionTo(PermissionName::OrdersView->value);

    $user = sharedProps($customer)['auth']['user'];

    expect($user['permissions'])->toBe([])
        ->and($user['abilities'])->toBe([])
        ->and($customer->can(PermissionName::OrdersView->value))->toBeFalse();
});

it('never leaks secrets or other users data anywhere in the page json', function (): void {
    $secretive = User::factory()->owner()->withTwoFactor()->create([
        'password' => 'correct-horse-battery-staple',
        'remember_token' => 'remember-token-0123456789abcdef',
        'google_id' => 'google-subject-424242',
        'notes_internal' => 'internal staff note about me',
    ]);
    $other = User::factory()->create(['name' => 'Somebody Else', 'email' => 'somebody-else@example.test', 'phone_e164' => '+919800011122']);
    $raw = User::query()->findOrFail($secretive->id);
    $needles = array_filter([
        $raw->getRawOriginal('password'),
        $raw->getRawOriginal('two_factor_secret'),
        $raw->getRawOriginal('two_factor_recovery_codes'),
        decrypt($raw->getRawOriginal('two_factor_secret')),
        'remember-token-0123456789abcdef',
        'google-subject-424242',
        'internal staff note about me',
        'somebody-else@example.test',
        '+919800011122',
        'Somebody Else',
        $other->id,
    ]);

    $pages = [
        json_encode(firstLoadPage($secretive)->viewData('page'), JSON_THROW_ON_ERROR),
        json_encode(sharedProps($secretive, ['staffCounters', 'healthBanners', 'auth']), JSON_THROW_ON_ERROR),
        json_encode(sharedProps($secretive), JSON_THROW_ON_ERROR),
    ];

    foreach ($pages as $json) {
        foreach ($needles as $needle) {
            expect($json)->not->toContain($needle);
        }

        foreach (['"password"', 'two_factor_secret', 'two_factor_recovery_codes', 'remember_token', 'rememberToken', 'twoFactorSecret', 'recoveryCodes', 'googleId', 'notesInternal'] as $key) {
            expect($json)->not->toContain($key);
        }
    }
});

it('counts the unread database notifications of the user', function (): void {
    $user = User::factory()->create();
    $other = User::factory()->create();

    foreach ([[$user, null], [$user, null], [$user, now()], [$other, null]] as [$notifiable, $readAt]) {
        DB::table('notifications')->insert([
            'id' => (string) Str::uuid(),
            'type' => 'order.submitted',
            'notifiable_type' => $notifiable->getMorphClass(),
            'notifiable_id' => $notifiable->getKey(),
            'data' => '{}',
            'read_at' => $readAt,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    expect(sharedProps($user)['unreadNotifications'])->toBe(2);
});

it('reports zero unread notifications for a user without any', function (): void {
    expect(sharedProps(User::factory()->create())['unreadNotifications'])->toBe(0);
});

it('resolves the staff counters only on a partial reload, from the orders in state submitted and accepted', function (): void {
    Order::factory()->count(2)->inState(Submitted::class)->create();
    Order::factory()->inState(Accepted::class)->create();
    $staff = User::factory()->estimator()->create();

    expect(sharedProps($staff))->not->toHaveKey('staffCounters')
        ->and(sharedProps($staff, ['staffCounters'])['staffCounters'])->toBe(['submitted' => 2, 'toCall' => 1]);
});

it('caches the staff counters for 30 seconds', function (): void {
    Order::factory()->inState(Submitted::class)->create();
    $staff = User::factory()->support()->create();

    expect(sharedProps($staff, ['staffCounters'])['staffCounters'])->toBe(['submitted' => 1, 'toCall' => 0]);

    Order::factory()->inState(Submitted::class)->create();

    expect(Cache::has('staff:counters'))->toBeTrue()
        ->and(sharedProps($staff, ['staffCounters'])['staffCounters']['submitted'])->toBe(1);

    $this->travel(31)->seconds();

    expect(sharedProps($staff, ['staffCounters'])['staffCounters']['submitted'])->toBe(2);
});

it('resolves the staff counters to null for customers, guests and inactive staff', function (): void {
    Order::factory()->inState(Submitted::class)->create();

    expect(sharedProps(User::factory()->create(), ['staffCounters'])['staffCounters'])->toBeNull()
        ->and(sharedProps(User::factory()->admin()->inactive()->create(), ['staffCounters'])['staffCounters'])->toBeNull()
        ->and(Cache::has('staff:counters'))->toBeFalse();
});

it('shares a health banner per present health cache key for staff with settings.manage', function (): void {
    Cache::put('health:otp', ['status' => 'low_conversion']);

    expect(sharedProps(User::factory()->admin()->create())['healthBanners'])->toBe([
        ['key' => 'otp', 'messageKey' => 'admin.health.otp.low_conversion'],
    ])->and(sharedProps(User::factory()->estimator()->create())['healthBanners'])->toBe([]);
});

it('lists the banners in the order whatsapp, sms, otp and skips malformed entries', function (): void {
    Cache::put('health:otp', ['status' => 'low_conversion']);
    Cache::put('health:whatsapp', ['status' => 'template_rejected']);
    Cache::put('health:sms', ['status' => 'Not A Key!']);

    expect(sharedProps(User::factory()->owner()->create())['healthBanners'])->toBe([
        ['key' => 'whatsapp', 'messageKey' => 'admin.health.whatsapp.template_rejected'],
        ['key' => 'otp', 'messageKey' => 'admin.health.otp.low_conversion'],
    ]);
});

it('shares no health banners with customers or inactive admins', function (): void {
    Cache::put('health:otp', ['status' => 'low_conversion']);

    expect(sharedProps(User::factory()->create())['healthBanners'])->toBe([])
        ->and(sharedProps(User::factory()->admin()->inactive()->create())['healthBanners'])->toBe([]);
});

it('shares the session flash messages', function (): void {
    $flash = sharedProps(session: ['success' => 'Saved.', 'error' => 'Nope.'])['flash'];

    expect($flash)->toBe(['success' => 'Saved.', 'error' => 'Nope.', 'info' => null, 'warning' => null]);
});

it('keeps the sidebar state from its cookie', function (): void {
    expect(sharedProps()['sidebarOpen'])->toBeTrue()
        ->and(test()->withUnencryptedCookie('sidebar_state', 'false')->withHeaders(['X-Inertia' => 'true'])->get('/_props')->json('props.sidebarOpen'))->toBeFalse();
});

it('runs no database query for a guest once the settings are cached', function (): void {
    sharedProps();

    DB::flushQueryLog();
    DB::enableQueryLog();
    sharedProps();
    $queries = DB::getQueryLog();
    DB::disableQueryLog();

    expect($queries)->toBe([]);
});

it('reads nothing but the settings from the database for a cold guest request', function (): void {
    DB::enableQueryLog();
    sharedProps();
    $queries = collect(DB::getQueryLog())->pluck('query')->all();
    DB::disableQueryLog();

    expect($queries)->not->toBeEmpty();

    foreach ($queries as $query) {
        expect($query)->toContain('app_settings');
    }
});

it('runs a bounded number of queries for an authenticated user, whatever the permission count', function (): void {
    $ids = [
        'customer' => User::factory()->create()->id,
        'owner' => User::factory()->owner()->create()->id,
        'admin' => User::factory()->admin()->create()->id,
    ];
    // Warm the caches (settings, spatie's permission registry) that serve every later request.
    sharedProps(User::query()->findOrFail($ids['customer']));
    sharedProps(User::query()->findOrFail($ids['owner']));

    // A fresh model per measurement, as the session guard hands one over on each request.
    $count = static function (string $id): int {
        $user = User::query()->findOrFail($id);

        DB::flushQueryLog();
        DB::enableQueryLog();
        sharedProps($user);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        return count($queries);
    };

    // Customers: avatar media and unread count. Staff add roles, role permissions and direct permissions.
    expect($count($ids['customer']))->toBe(2)
        ->and($count($ids['owner']))->toBe(5)
        ->and($count($ids['admin']))->toBe(5);
});

it('runs no staff-counter query on a normal page load', function (): void {
    $staff = User::factory()->admin()->create();

    DB::enableQueryLog();
    sharedProps($staff);
    $queries = collect(DB::getQueryLog())->pluck('query')->implode("\n");
    DB::disableQueryLog();

    expect($queries)->not->toContain('"orders"');
});
