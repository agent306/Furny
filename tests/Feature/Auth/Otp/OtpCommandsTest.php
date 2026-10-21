<?php

declare(strict_types=1);

use App\Domain\Identity\Models\OtpCode;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;

/** Codes sent in the last hour, of which `$verified` were entered. */
function otpTraffic(int $sent, int $verified, ?DateTimeInterface $at = null): void
{
    $at ??= now()->subMinutes(10);

    OtpCode::factory()->count($sent - $verified)->create(['created_at' => $at]);
    OtpCode::factory()->consumed()->count($verified)->create(['created_at' => $at]);
}

describe('otp:monitor (13 section 4.5)', function (): void {
    beforeEach(function (): void {
        $this->records = [];
        Event::listen(MessageLogged::class, function (MessageLogged $log): void {
            $this->records[] = $log;
        });
    });

    it('switches the captcha on for an hour and raises the banner when 50 were sent and 9 verified', function (): void {
        $this->freezeTime();
        otpTraffic(50, 9);

        $this->artisan('otp:monitor')->assertSuccessful();

        $banner = Cache::get('health:otp');
        expect(Cache::get('auth:captcha_always'))->toBeTrue()
            ->and($banner['status'])->toBe('low_conversion')
            ->and($banner['sent'])->toBe(50)->and($banner['verified'])->toBe(9)
            ->and(collect($this->records)->filter(fn (MessageLogged $log): bool => $log->level === 'critical' && $log->message === 'otp.low_conversion')->count())->toBe(1);

        $this->travel(59)->minutes();
        expect(Cache::has('auth:captcha_always'))->toBeTrue()->and(Cache::has('health:otp'))->toBeTrue();

        $this->travel(2)->minutes();
        expect(Cache::has('auth:captcha_always'))->toBeFalse()->and(Cache::has('health:otp'))->toBeFalse();
    });

    it('leaves everything alone at exactly one in five (50 sent, 10 verified)', function (): void {
        otpTraffic(50, 10);

        $this->artisan('otp:monitor')->assertSuccessful();

        expect(Cache::has('auth:captcha_always'))->toBeFalse()->and(Cache::has('health:otp'))->toBeFalse()
            ->and(collect($this->records)->where('message', 'otp.low_conversion')->count())->toBe(0);
    });

    it('leaves everything alone below 50 sends, however few were verified (49 sent, none verified)', function (): void {
        otpTraffic(49, 0);

        $this->artisan('otp:monitor')->assertSuccessful();

        expect(Cache::has('auth:captcha_always'))->toBeFalse()->and(Cache::has('health:otp'))->toBeFalse();
    });

    it('looks at the last hour only', function (): void {
        otpTraffic(60, 0, now()->subMinutes(61));
        otpTraffic(10, 10);

        $this->artisan('otp:monitor')->assertSuccessful();

        expect(Cache::has('auth:captcha_always'))->toBeFalse();
    });

    it('counts a code of the last hour as verified once it has been consumed', function (): void {
        otpTraffic(50, 0);
        OtpCode::query()->limit(10)->update(['consumed_at' => now()]);

        $this->artisan('otp:monitor')->assertSuccessful();

        expect(Cache::has('auth:captcha_always'))->toBeFalse();
    });

    it('says what it counted', function (): void {
        otpTraffic(5, 2);

        $this->artisan('otp:monitor')->expectsOutputToContain('5 sent, 2 verified')->assertSuccessful();
    });
});

describe('otp:prune (13 section 4.1)', function (): void {
    it('deletes the codes that expired more than 24 hours ago, and only those', function (): void {
        $this->freezeTime();
        $old = OtpCode::factory()->create(['expires_at' => now()->subDay()->subSecond()]);
        $oldConsumed = OtpCode::factory()->consumed()->create(['expires_at' => now()->subDays(3)]);
        $recent = OtpCode::factory()->create(['expires_at' => now()->subDay()->addMinute()]);
        $expiredToday = OtpCode::factory()->expired()->create();
        $live = OtpCode::factory()->create();

        $this->artisan('otp:prune')->expectsOutputToContain('Deleted 2')->assertSuccessful();

        expect(OtpCode::query()->pluck('id')->all())->toEqualCanonicalizing([$recent->id, $expiredToday->id, $live->id])
            ->and(OtpCode::query()->whereKey([$old->id, $oldConsumed->id])->exists())->toBeFalse();
    });

    it('does nothing when there is nothing to delete', function (): void {
        OtpCode::factory()->create();

        expect(Artisan::call('otp:prune'))->toBe(0)->and(OtpCode::query()->count())->toBe(1);
    });
});
