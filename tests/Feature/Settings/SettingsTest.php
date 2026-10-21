<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Settings\Models\AppSetting;
use App\Domain\Settings\Models\BusinessProfile;
use App\Support\Settings\CatalogVersion;
use App\Support\Settings\Groups\AiSettings;
use App\Support\Settings\Groups\NotificationsSettings;
use App\Support\Settings\Groups\PricingSettings;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    // Pristine state regardless of any baseline seeding (16 §2).
    AppSetting::query()->delete();
});

function settings(): Settings
{
    return app(Settings::class);
}

it('is a container singleton', function (): void {
    expect(app(Settings::class))->toBe(app(Settings::class));
});

it('returns the 02 §13 defaults for business when no row exists', function (): void {
    $business = settings()->business();

    expect($business->currency)->toBe('INR')
        ->and($business->locale)->toBe('en-IN')
        ->and($business->timezone)->toBe('Asia/Kolkata')
        ->and($business->workingHours)->toBe('Mon–Sat 10:00–19:00')
        ->and($business->name)->toBe(config('app.name'))
        ->and($business->email)->toBe(config('mail.from.address'))
        ->and($business->legalName)->toBeNull()
        ->and($business->address)->toBeNull()
        ->and($business->logoMediaId)->toBeNull()
        ->and($business->quoteTerms)->toBe(trans_icu('quotes.default_terms'));
});

it('returns the 02 §13 defaults for units', function (): void {
    $units = settings()->units();

    expect($units->defaultSystem)->toBe('metric')
        ->and($units->defaultLengthUnit)->toBe('mm')
        ->and([
            $units->defaultWallHeightMm, $units->defaultExteriorWallThicknessMm, $units->defaultInteriorWallThicknessMm,
            $units->defaultDoorWidthMm, $units->defaultDoorHeightMm, $units->defaultWindowWidthMm,
            $units->defaultWindowHeightMm, $units->defaultWindowSillMm,
        ])->toBe([2700, 230, 115, 900, 2100, 1200, 1200, 900]);
});

it('returns the 02 §13 defaults for pricing', function (): void {
    $pricing = settings()->pricing();

    expect($pricing->pricesIncludeTax)->toBeFalse()
        ->and($pricing->defaultTaxRateId)->toBeNull()
        ->and($pricing->marginBps)->toBe(3500)
        ->and($pricing->overheadBps)->toBe(1000)
        ->and($pricing->minimumOrderMinor)->toBe(0)
        ->and($pricing->roundingMinor)->toBe(100)
        ->and($pricing->estimateDisclaimerKey)->toBe('estimates.disclaimer')
        ->and($pricing->installationBps)->toBe(800)
        ->and($pricing->deliveryFlatMinor)->toBe(0)
        ->and($pricing->kerfMm)->toBe(4.0)
        ->and($pricing->sheetTrimMm)->toBe(10)
        ->and($pricing->nestingAllowRotationDefault)->toBeTrue()
        ->and($pricing->sheetBillingMode)->toBe('used_area')
        ->and($pricing->edgePremillMm)->toBe(0);
});

it('returns the 02 §13 defaults for workflow with the eight production stages of 09 §8', function (): void {
    $workflow = settings()->workflow();

    expect([$workflow->quoteValidityDays, $workflow->autoCloseDays, $workflow->reminderAfterHours])->toBe([15, 14, 48])
        ->and($workflow->requireCompletionPhotos)->toBe(1)
        ->and($workflow->allowCustomerCounterOffer)->toBeTrue()
        ->and($workflow->maxNegotiationRounds)->toBe(5)
        ->and($workflow->minPreferredDeliveryDays)->toBe(7)
        ->and(collect($workflow->productionStages)->mapWithKeys(fn ($stage) => [$stage->key => $stage->defaultProgress])->all())->toBe([
            'material_procurement' => 10, 'cutting' => 25, 'edge_banding' => 40, 'drilling' => 50,
            'finishing' => 65, 'assembly' => 80, 'quality_check' => 90, 'packing' => 95,
        ]);

    foreach ($workflow->productionStages as $stage) {
        expect($stage->labelKey)->toBe("production.stages.{$stage->key}")
            ->and($stage->label)->toBeNull()
            ->and(trans_icu($stage->labelKey))->not->toBe($stage->labelKey);
    }
});

it('returns the 02 §13 defaults for ai', function (): void {
    $ai = settings()->ai();

    expect($ai->provider)->toBe('anthropic')
        ->and($ai->model)->toBe('claude-opus-5-5')
        ->and($ai->effort)->toBe('high')
        ->and($ai->agenticCrops)->toBeTrue()
        ->and($ai->fallbackToNoneOnError)->toBeTrue()
        ->and([$ai->signupCredits, $ai->monthlyCredits, $ai->creditsPerRecognition, $ai->creditsPerRecognitionNone, $ai->maxRecognitionsPerDay])->toBe([3, 3, 1, 0, 5])
        ->and($ai->globalMonthlyBudgetUsd)->toBe('50.00')
        ->and($ai->budgetExhaustedBehavior)->toBe('fallback_none')
        ->and($ai->staffUnlimited)->toBeTrue()
        ->and(collect($ai->priceTable)->map(fn ($row) => [$row->provider, $row->model, $row->inputPerMtokUsd, $row->outputPerMtokUsd])->all())->toBe([
            ['anthropic', 'claude-opus-5-5', '4.00', '20.00'],
            ['anthropic', 'claude-sonnet-5-5', '2.00', '10.00'],
            ['anthropic', 'claude-haiku-5-5', '0.10', '0.50'],
        ]);
});

it('returns the 02 §13 defaults for notifications', function (): void {
    $notifications = settings()->notifications();

    expect($notifications->whatsappTemplates)->toBe([])
        ->and($notifications->smsDriver)->toBe('log')
        ->and($notifications->otpChannelOrder)->toBe(['whatsapp', 'sms'])
        ->and($notifications->staffDigestHour)->toBe(9)
        ->and($notifications->quietHours->toArray())->toBe(['enabled' => true, 'start' => '21:00', 'end' => '08:00'])
        ->and(array_keys($notifications->smsTemplates))->toBe(NotificationsSettings::SMS_EVENT_KEYS);
});

it('returns the 02 §13 defaults for auth', function (): void {
    $auth = settings()->auth();

    expect($auth->allowCustomerRegistration)->toBeTrue()
        ->and($auth->otpAllowedCountryCodes)->toBe(['IN'])
        ->and($auth->otpGlobalHourlyCap)->toBe(200)
        ->and($auth->staffSessionAbsoluteHours)->toBe(12);
});

it('starts the catalog version at 1 and the seed as not reviewed', function (): void {
    expect(settings()->catalogVersion())->toBe(1)
        ->and(settings()->seedReviewed())->toBeFalse();
});

it('marks the starter catalog as reviewed', function (): void {
    expect(settings()->seedReviewed())->toBeFalse();

    settings()->markSeedReviewed();

    expect(settings()->seedReviewed())->toBeTrue()
        ->and(AppSetting::query()->find('catalog.seed_reviewed')->value)->toBeTrue();
});

it('defines the restricted groups and the data class of every group', function (): void {
    expect(collect(SettingsGroup::cases())->filter->isRestricted()->map->value->values()->all())->toBe(['ai', 'auth'])
        ->and(collect(SettingsGroup::cases())->map(fn ($group) => $group->dataClass()::defaults()::class)->all())
        ->toHaveCount(7);
});

it('merges stored fields over the defaults and fills a missing field (edge_premill_mm)', function (): void {
    $stored = PricingSettings::defaults()->toStorage();
    unset($stored['edge_premill_mm']);
    $stored['margin_bps'] = 4200;
    AppSetting::query()->create(['key' => 'pricing', 'value' => $stored]);

    $pricing = settings()->pricing();

    expect($pricing->edgePremillMm)->toBe(0)
        ->and($pricing->marginBps)->toBe(4200);
});

it('reads partial stored documents (a single stored field)', function (): void {
    AppSetting::query()->create(['key' => 'business', 'value' => ['name' => 'Oak & Co', 'phone_e164' => '+919876543210']]);

    $business = settings()->business();

    expect($business->name)->toBe('Oak & Co')
        ->and($business->phoneE164)->toBe('+919876543210')
        ->and($business->currency)->toBe('INR');
});

it('casts stored numbers to the property types', function (): void {
    AppSetting::query()->create(['key' => 'pricing', 'value' => ['kerf_mm' => 3]]);

    expect(settings()->pricing()->kerfMm)->toBe(3.0);
});

it('busts the cache on put so the next get sees the new value', function (): void {
    expect(settings()->pricing()->marginBps)->toBe(3500);

    $changed = PricingSettings::from([...PricingSettings::defaults()->toStorage(), 'margin_bps' => 4000]);
    settings()->put(SettingsGroup::Pricing, $changed, null);

    expect(settings()->pricing()->marginBps)->toBe(4000);
});

it('busts the cache after commit when put runs inside a transaction', function (): void {
    expect(settings()->pricing()->marginBps)->toBe(3500);

    DB::transaction(function (): void {
        settings()->put(SettingsGroup::Pricing, PricingSettings::from([...PricingSettings::defaults()->toStorage(), 'margin_bps' => 4100]), null);
    });

    expect(settings()->pricing()->marginBps)->toBe(4100);
});

it('stores updated_by and replaces the whole document on put', function (): void {
    $user = User::factory()->create();

    settings()->put(SettingsGroup::Pricing, PricingSettings::defaults(), $user);

    $row = AppSetting::query()->find('pricing');

    expect($row->updated_by)->toBe($user->id)
        ->and($row->value)->toHaveKey('margin_bps', 3500)
        ->and($row->updatedBy->is($user))->toBeTrue();

    settings()->put(SettingsGroup::Pricing, PricingSettings::defaults(), null);

    expect(AppSetting::query()->find('pricing')->updated_by)->toBeNull()
        ->and(AppSetting::query()->count())->toBe(1);
});

it('refuses a data object of another group', function (): void {
    settings()->put(SettingsGroup::Pricing, AiSettings::defaults(), null);
})->throws(InvalidArgumentException::class);

it('exposes snake_case storage and camelCase wire keys', function (): void {
    $defaults = PricingSettings::defaults();

    expect($defaults->toWire())->toHaveKey('marginBps', 3500)->not->toHaveKey('margin_bps')
        ->and($defaults->toStorage())->toHaveKey('margin_bps', 3500)->not->toHaveKey('marginBps')
        ->and($defaults->toWire()['kerfMm'])->toBe(4.0);
});

it('maps nested data to camelCase on the wire and snake_case in storage', function (): void {
    $notifications = NotificationsSettings::defaults();

    expect($notifications->toWire()['smsTemplates']['auth.otp'])->toBe(['textKey' => 'notifications.auth.otp.sms', 'dltTemplateId' => null, 'providerTemplateId' => null])
        ->and($notifications->toStorage()['sms_templates']['auth.otp'])->toBe(['text_key' => 'notifications.auth.otp.sms', 'dlt_template_id' => null, 'provider_template_id' => null])
        ->and(settings()->workflow()->toWire()['productionStages'][0])->toBe(['key' => 'material_procurement', 'labelKey' => 'production.stages.material_procurement', 'label' => null, 'defaultProgress' => 10])
        ->and(settings()->ai()->toWire()['priceTable'][0])->toBe(['provider' => 'anthropic', 'model' => 'claude-opus-5-5', 'inputPerMtokUsd' => '4.00', 'outputPerMtokUsd' => '20.00']);
});

it('renders empty maps as JSON objects on the wire and in storage', function (): void {
    $notifications = NotificationsSettings::defaults();

    expect(json_encode($notifications->toWire()['whatsappTemplates']))->toBe('{}')
        ->and(json_encode($notifications->toStorage()['whatsapp_templates']))->toBe('{}')
        ->and(json_encode(settings()->ai()->toWire()['priceTable']))->toStartWith('[');
});

it('round-trips a WhatsApp template map', function (): void {
    $templates = [
        'quote.sent' => [
            'name' => 'quote_sent', 'language' => 'en',
            'components' => [
                ['type' => 'body', 'params' => ['quoteNumber', 'total']],
                ['type' => 'button', 'sub_type' => 'url', 'index' => 0, 'param' => 'quoteId'],
            ],
        ],
    ];
    $stored = [...NotificationsSettings::defaults()->toStorage(), 'whatsapp_templates' => $templates];
    settings()->put(SettingsGroup::Notifications, NotificationsSettings::from($stored), null);

    $read = settings()->notifications();

    expect($read->whatsappTemplates['quote.sent']->name)->toBe('quote_sent')
        ->and($read->toStorage()['whatsapp_templates'])->toEqual($templates);
});

it('bumps the catalog version atomically', function (): void {
    expect(CatalogVersion::bump())->toBe(2)
        ->and(CatalogVersion::bump())->toBe(3)
        ->and(settings()->catalogVersion())->toBe(3)
        ->and(AppSetting::query()->find('catalog.version')->value)->toBe(3);
});

it('increments an existing catalog version row and busts the cache', function (): void {
    AppSetting::query()->create(['key' => 'catalog.version', 'value' => 7]);

    expect(settings()->catalogVersion())->toBe(7)
        ->and(CatalogVersion::bump())->toBe(8)
        ->and(settings()->catalogVersion())->toBe(8);
});

it('leaves the catalog version unchanged when the surrounding transaction rolls back', function (): void {
    expect(settings()->catalogVersion())->toBe(1);

    try {
        DB::transaction(function (): void {
            CatalogVersion::bump();

            throw new RuntimeException('abort');
        });
    } catch (RuntimeException) {
    }

    expect(settings()->catalogVersion())->toBe(1)
        ->and(AppSetting::query()->find('catalog.version'))->toBeNull();
});

it('exposes the business logo owner as a singleton row with a mapped morph class', function (): void {
    $profile = BusinessProfile::instance();

    expect($profile->getKey())->toBe('business')
        ->and($profile->getMorphClass())->toBe('business_profile')
        ->and(BusinessProfile::instance()->is($profile))->toBeTrue()
        ->and(AppSetting::query()->count())->toBe(1)
        ->and($profile->getMediaCollection('logo')->singleFile)->toBeTrue()
        ->and($profile->getMediaCollection('logo')->diskName)->toBe('s3-public')
        ->and(settings()->business()->name)->toBe(config('app.name'));
});

it('does not disturb stored business settings when the logo owner is resolved', function (): void {
    AppSetting::query()->create(['key' => 'business', 'value' => ['name' => 'Oak & Co']]);

    BusinessProfile::instance();

    expect(AppSetting::query()->find('business')->value)->toBe(['name' => 'Oak & Co']);
});
