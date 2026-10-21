<?php

declare(strict_types=1);

use App\Domain\Settings\Models\AppSetting;
use App\Support\Settings\Groups\NotificationsSettings;
use App\Support\Settings\Settings;
use Database\Seeders\SettingsSeeder;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    AppSetting::query()->delete();
});

function seedSettings(): void
{
    app(SettingsSeeder::class)->run();
}

it('seeds the nine keys of 02 §2.1', function (): void {
    seedSettings();

    expect(AppSetting::query()->pluck('key')->sort()->values()->all())->toBe([
        'ai', 'auth', 'business', 'catalog.seed_reviewed', 'catalog.version', 'notifications', 'pricing', 'units', 'workflow',
    ])
        ->and(AppSetting::query()->find('catalog.version')->value)->toBe(1)
        ->and(AppSetting::query()->find('catalog.seed_reviewed')->value)->toBeFalse();
});

it('seeds the auth country allowlist with IN', function (): void {
    seedSettings();

    expect(AppSetting::query()->find('auth')->value['otp_allowed_country_codes'])->toBe(['IN'])
        ->and(app(Settings::class)->auth()->otpAllowedCountryCodes)->toBe(['IN']);
});

it('derives the country allowlist from the business address when one is stored', function (): void {
    AppSetting::query()->create(['key' => 'business', 'value' => ['address' => ['country_code' => 'ae']]]);

    seedSettings();

    expect(AppSetting::query()->find('auth')->value['otp_allowed_country_codes'])->toBe(['AE']);
});

it('seeds the twelve SMS templates with text keys and null ids', function (): void {
    seedSettings();

    $templates = AppSetting::query()->find('notifications')->value['sms_templates'];

    expect(collect($templates)->keys()->sort()->values()->all())->toBe(collect(NotificationsSettings::SMS_EVENT_KEYS)->sort()->values()->all())
        ->and($templates)->toHaveCount(12)
        ->and($templates['auth.otp'])->toBe(['text_key' => 'notifications.auth.otp.sms', 'dlt_template_id' => null, 'provider_template_id' => null])
        ->and($templates['quote.sent'])->toBe(['text_key' => 'notifications.quote.sent.customer.sms', 'dlt_template_id' => null, 'provider_template_id' => null]);

    foreach ($templates as $key => $template) {
        expect($template['text_key'])->toBe($key === 'auth.otp' ? 'notifications.auth.otp.sms' : "notifications.{$key}.customer.sms")
            ->and($template['dlt_template_id'])->toBeNull()
            ->and($template['provider_template_id'])->toBeNull();
    }
});

it('seeds the translated quote terms and leaves the tax rate for the tax seeder', function (): void {
    seedSettings();

    expect(AppSetting::query()->find('business')->value['quote_terms'])->toBe(trans_icu('quotes.default_terms'))
        ->and(AppSetting::query()->find('business')->value['quote_terms'])->not->toBe('quotes.default_terms')
        ->and(AppSetting::query()->find('pricing')->value['default_tax_rate_id'])->toBeNull();
});

it('stores whatsapp templates as an empty JSON object', function (): void {
    seedSettings();

    $raw = DB::table('app_settings')->where('key', 'notifications')->value('value');

    expect(json_decode($raw)->whatsapp_templates)->toEqual((object) []);
});

it('is idempotent: keeps changed values, restores deleted fields and adds nothing twice', function (): void {
    seedSettings();

    $business = AppSetting::query()->find('business');
    $value = $business->value;
    $value['name'] = 'Oak & Co';
    unset($value['currency']);
    $business->update(['value' => $value]);
    AppSetting::query()->find('catalog.version')->update(['value' => 9]);

    seedSettings();

    $business = AppSetting::query()->find('business');

    expect($business->value['name'])->toBe('Oak & Co')
        ->and($business->value['currency'])->toBe('INR')
        ->and(AppSetting::query()->count())->toBe(9)
        ->and(AppSetting::query()->find('catalog.version')->value)->toBe(9);
});

it('keeps empty maps as JSON objects when it fills a missing field of an existing group', function (): void {
    seedSettings();

    $notifications = AppSetting::query()->find('notifications');
    $value = $notifications->value;
    unset($value['sms_driver']);
    $notifications->update(['value' => $value]);

    seedSettings();

    $raw = json_decode((string) DB::table('app_settings')->where('key', 'notifications')->value('value'));

    expect($raw->sms_driver)->toBe('log')
        ->and($raw->whatsapp_templates)->toEqual((object) []);

    $before = DB::table('app_settings')->where('key', 'notifications')->value('updated_at');
    seedSettings();

    expect(DB::table('app_settings')->where('key', 'notifications')->value('updated_at'))->toBe($before);
});

it('busts the cached groups it changes', function (): void {
    expect(app(Settings::class)->auth()->otpAllowedCountryCodes)->toBe(['IN']);

    AppSetting::query()->create(['key' => 'business', 'value' => ['address' => ['country_code' => 'AE']]]);
    AppSetting::query()->create(['key' => 'auth', 'value' => ['otp_global_hourly_cap' => 50]]);

    seedSettings();

    $auth = app(Settings::class)->auth();

    expect($auth->otpGlobalHourlyCap)->toBe(50)
        ->and($auth->otpAllowedCountryCodes)->toBe(['AE']);
});
