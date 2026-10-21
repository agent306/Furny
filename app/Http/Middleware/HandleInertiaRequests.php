<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Data\AuthUserData;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\OrderStateKey;
use App\Domain\Orders\Models\Order;
use App\Domain\Settings\Data\BusinessPublicData;
use App\Domain\Settings\Models\BusinessProfile;
use App\Support\Features;
use App\Support\Media\Media;
use App\Support\Settings\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Inertia\Inertia;
use Inertia\Middleware;

/**
 * The shared props (01 §6, 15 §8). Everything here is visible to the browser: each prop is built
 * field by field from public data (never from a whole model or settings group), and guests cost no
 * database query beyond the cached settings. Props that need the database are closures, so a partial
 * reload computes only what it asks for.
 */
final class HandleInertiaRequests extends Middleware
{
    /** Cache key and lifetime in seconds of the sidebar badges (11 §4). */
    public const string STAFF_COUNTERS_KEY = 'staff:counters';

    public const int STAFF_COUNTERS_TTL = 30;

    /** The cache keys of the integration health monitors (13 §4.5, 12 §11), in banner order. */
    private const array HEALTH_KEYS = ['whatsapp', 'sms', 'otp'];

    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    public function __construct(private readonly Settings $settings) {}

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $user = $request->user();
        $user = $user instanceof User ? $user : null;

        $props = [
            ...parent::share($request),
            'app' => fn (): array => [
                'name' => config('app.name'),
                'logoUrl' => $this->logoUrl(),
                'version' => config('app.version'),
            ],
            'auth' => fn (): array => [
                'user' => $user === null ? null : AuthUserData::fromUser($user)->toArray(),
            ],
            'business' => fn (): array => BusinessPublicData::fromSettings($this->settings->business(), $this->settings->units())->toArray(),
            'features' => fn (): array => Features::all(),
            'flash' => fn (): array => $this->flash($request),
            'i18n' => fn (): array => $this->i18n(),
            // The sidebar's open state lives in a cookie the layout reads before it renders (15 §7).
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
        ];

        if ($user !== null) {
            $props['unreadNotifications'] = static fn (): int => $user->unreadNotifications()->count();
            $props['staffCounters'] = Inertia::optional(fn (): ?array => $this->staffCounters($user));
            $props['healthBanners'] = fn (): array => $this->healthBanners($user);
        }

        return $props;
    }

    /** The business logo; its media id is part of the cache key, so replacing the logo needs no invalidation. */
    private function logoUrl(): ?string
    {
        $mediaId = $this->settings->business()->logoMediaId;

        if ($mediaId === null) {
            return null;
        }

        $url = Cache::rememberForever(
            BusinessProfile::KEY.":logo-url:{$mediaId}",
            static fn (): string => Media::query()->find($mediaId)?->getUrl() ?? '',
        );

        return $url === '' ? null : $url;
    }

    /**
     * Already-translated messages that controllers flashed into the session.
     *
     * @return array{success: ?string, error: ?string, info: ?string, warning: ?string}
     */
    private function flash(Request $request): array
    {
        $message = static function (string $type) use ($request): ?string {
            $value = $request->hasSession() ? $request->session()->get($type) : null;

            return is_string($value) ? $value : null;
        };

        return [
            'success' => $message('success'),
            'error' => $message('error'),
            'info' => $message('info'),
            'warning' => $message('warning'),
        ];
    }

    /**
     * The locale and the content hash of its catalogue (`resources/js/lang/generated/manifest.json`); a
     * locale without a catalogue falls back to English, like the frontend does.
     *
     * @return array{locale: string, hash: string}
     */
    private function i18n(): array
    {
        $path = resource_path('js/lang/generated/manifest.json');
        $manifest = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
        $manifest = is_array($manifest) ? $manifest : [];
        $locale = app()->getLocale();
        $locale = isset($manifest[$locale]) ? $locale : 'en';

        return ['locale' => $locale, 'hash' => (string) ($manifest[$locale] ?? '')];
    }

    /**
     * `{submitted, toCall}` for active staff, else null. The numbers are not per user, so one cache
     * entry serves every staff member for 30 seconds.
     *
     * @return array{submitted: int, toCall: int}|null
     */
    private function staffCounters(User $user): ?array
    {
        if (! $user->isStaff() || ! $user->is_active) {
            return null;
        }

        return Cache::remember(self::STAFF_COUNTERS_KEY, self::STAFF_COUNTERS_TTL, static function (): array {
            $counts = Order::query()->toBase()
                ->whereIn('state', [OrderStateKey::Submitted->value, OrderStateKey::Accepted->value])
                ->selectRaw('state, count(*) as total')
                ->groupBy('state')
                ->pluck('total', 'state');

            return [
                'submitted' => (int) ($counts[OrderStateKey::Submitted->value] ?? 0),
                'toCall' => (int) ($counts[OrderStateKey::Accepted->value] ?? 0),
            ];
        });
    }

    /**
     * One banner per health monitor that reports a problem (its cache key is present), for users who
     * can manage settings.
     *
     * @return list<array{key: string, messageKey: string}>
     */
    private function healthBanners(User $user): array
    {
        if (! $user->can(PermissionName::SettingsManage->value)) {
            return [];
        }

        $entries = Cache::many(array_map(static fn (string $key): string => "health:{$key}", self::HEALTH_KEYS));
        $banners = [];

        foreach (self::HEALTH_KEYS as $key) {
            $status = is_array($entries["health:{$key}"] ?? null) ? ($entries["health:{$key}"]['status'] ?? null) : null;

            // The status becomes part of a translation key: accept identifiers only.
            if (is_string($status) && preg_match('/^[a-z][a-z0-9_]*$/', $status) === 1) {
                $banners[] = ['key' => $key, 'messageKey' => "admin.health.{$key}.{$status}"];
            }
        }

        return $banners;
    }
}
