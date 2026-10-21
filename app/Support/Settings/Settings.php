<?php

declare(strict_types=1);

namespace App\Support\Settings;

use App\Domain\Identity\Models\User;
use App\Domain\Settings\Models\AppSetting;
use App\Support\Settings\Groups\AiSettings;
use App\Support\Settings\Groups\AuthSettings;
use App\Support\Settings\Groups\BusinessSettings;
use App\Support\Settings\Groups\NotificationsSettings;
use App\Support\Settings\Groups\PricingSettings;
use App\Support\Settings\Groups\SettingsData;
use App\Support\Settings\Groups\UnitsSettings;
use App\Support\Settings\Groups\WorkflowSettings;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use LogicException;

/**
 * Typed, cached access to `app_settings` (02 §2.1). The stored document of a group is cached under
 * `settings:{key}`; `get()` merges the stored fields over the defaults, so a group without a row, or
 * a row lacking a newer field, still yields a complete object. Writes bust the cache after commit.
 */
final class Settings
{
    public const string CATALOG_VERSION_KEY = 'catalog.version';

    public const string SEED_REVIEWED_KEY = 'catalog.seed_reviewed';

    public function __construct(private readonly Cache $cache) {}

    public function get(SettingsGroup $group): SettingsData
    {
        $class = $group->dataClass();

        /** @var array<string, mixed> $stored */
        $stored = $this->cache->rememberForever(
            self::cacheKey($group->value),
            fn (): array => $this->storedDocument($group->value),
        );

        return $class::from([...self::normalise($class::defaults()->toStorage()), ...$stored]);
    }

    public function put(SettingsGroup $group, SettingsData $data, ?User $by = null): void
    {
        if (! $data instanceof ($group->dataClass())) {
            throw new InvalidArgumentException(sprintf('%s is not the data class of settings group "%s".', $data::class, $group->value));
        }

        AppSetting::query()->updateOrCreate(
            ['key' => $group->value],
            ['value' => $data->toStorage(), 'updated_by' => $by?->getKey()],
        );

        self::forgetAfterCommit($group->value);
    }

    /** The catalog version stamp (starts at 1); bumped by `CatalogVersion::bump()`. */
    public function catalogVersion(): int
    {
        return (int) $this->scalar(self::CATALOG_VERSION_KEY, 1);
    }

    /** Whether any catalog upsert happened since seeding (08 §7 banner). */
    public function seedReviewed(): bool
    {
        return (bool) $this->scalar(self::SEED_REVIEWED_KEY, false);
    }

    public function markSeedReviewed(): void
    {
        AppSetting::query()->updateOrCreate(['key' => self::SEED_REVIEWED_KEY], ['value' => true]);

        self::forgetAfterCommit(self::SEED_REVIEWED_KEY);
    }

    public function business(): BusinessSettings
    {
        return $this->typed(SettingsGroup::Business, BusinessSettings::class);
    }

    public function units(): UnitsSettings
    {
        return $this->typed(SettingsGroup::Units, UnitsSettings::class);
    }

    public function pricing(): PricingSettings
    {
        return $this->typed(SettingsGroup::Pricing, PricingSettings::class);
    }

    public function workflow(): WorkflowSettings
    {
        return $this->typed(SettingsGroup::Workflow, WorkflowSettings::class);
    }

    public function ai(): AiSettings
    {
        return $this->typed(SettingsGroup::Ai, AiSettings::class);
    }

    public function notifications(): NotificationsSettings
    {
        return $this->typed(SettingsGroup::Notifications, NotificationsSettings::class);
    }

    public function auth(): AuthSettings
    {
        return $this->typed(SettingsGroup::Auth, AuthSettings::class);
    }

    /**
     * @template T of SettingsData
     *
     * @param  class-string<T>  $class
     * @return T
     */
    private function typed(SettingsGroup $group, string $class): SettingsData
    {
        $data = $this->get($group);

        if (! $data instanceof $class) {
            throw new LogicException(sprintf('Settings group "%s" did not yield %s.', $group->value, $class));
        }

        return $data;
    }

    /** Busts the cached value of a key once the surrounding transaction (if any) has committed. */
    public static function forgetAfterCommit(string $key): void
    {
        DB::afterCommit(static fn (): bool => cache()->forget(self::cacheKey($key)));
    }

    private static function cacheKey(string $key): string
    {
        return "settings:{$key}";
    }

    /**
     * @return array<string, mixed>
     */
    private function storedDocument(string $key): array
    {
        $value = AppSetting::query()->find($key)?->value;

        return is_array($value) ? $value : [];
    }

    private function scalar(string $key, int|bool $default): mixed
    {
        return $this->cache->rememberForever(
            self::cacheKey($key),
            static fn (): mixed => AppSetting::query()->find($key)->value ?? $default,
        );
    }

    /**
     * Round-trips through JSON so empty maps rendered as objects for storage become arrays again.
     *
     * @param  array<string, mixed>  $storage
     * @return array<string, mixed>
     */
    private static function normalise(array $storage): array
    {
        return json_decode(json_encode($storage, JSON_THROW_ON_ERROR), true, flags: JSON_THROW_ON_ERROR);
    }
}
