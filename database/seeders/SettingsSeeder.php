<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Settings\Models\AppSetting;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Seeds every `app_settings` key (02 §13, §14 item 2). Idempotent: inserts missing keys and missing
 * fields of a group only, so values the owner changed survive `db:seed` on every deploy.
 */
final class SettingsSeeder extends Seeder
{
    public function run(): void
    {
        DB::transaction(function (): void {
            // Business first: the auth allowlist derives from its address.
            foreach (SettingsGroup::cases() as $group) {
                $this->seedGroup($group);
            }

            $this->seedKey(Settings::CATALOG_VERSION_KEY, 1);
            $this->seedKey(Settings::SEED_REVIEWED_KEY, false);
        });
    }

    private function seedGroup(SettingsGroup $group): void
    {
        $seed = $group->dataClass()::defaults()->toStorage();

        if ($group === SettingsGroup::Auth) {
            $seed['otp_allowed_country_codes'] = [$this->businessCountryCode()];
        }

        $row = AppSetting::query()->find($group->value);

        if ($row === null) {
            AppSetting::query()->create(['key' => $group->value, 'value' => $seed]);
            Settings::forgetAfterCommit($group->value);

            return;
        }

        $stored = is_array($row->value) ? $row->value : [];
        $merged = $stored + $seed;

        if ($merged !== $stored) {
            $row->value = $merged;
            $row->save();
            Settings::forgetAfterCommit($group->value);
        }
    }

    private function seedKey(string $key, int|bool $value): void
    {
        if (AppSetting::query()->whereKey($key)->doesntExist()) {
            AppSetting::query()->create(['key' => $key, 'value' => $value]);
            Settings::forgetAfterCommit($key);
        }
    }

    /** `business.address.country_code ?? 'IN'` (02 §13 `auth.otp_allowed_country_codes`). */
    private function businessCountryCode(): string
    {
        $business = AppSetting::query()->find(SettingsGroup::Business->value);
        $address = is_array($business?->value) ? ($business->value['address'] ?? null) : null;
        $code = is_array($address) ? ($address['country_code'] ?? null) : null;

        return is_string($code) && $code !== '' ? strtoupper($code) : 'IN';
    }
}
