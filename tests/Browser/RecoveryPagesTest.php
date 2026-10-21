<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\Password;

/** The password recovery and verification pages (10 §4.5, §4.6, §4.8): usable from 375 px up, one h1, accessible. */
const RECOVERY_NO_HORIZONTAL_SCROLL = 'document.documentElement.scrollWidth <= window.innerWidth';

/** The pages, by path, that a signed-out visitor sees; the reset page needs a real token. */
dataset('recovery pages', [
    'forgot password' => [fn (): string => '/forgot-password', false],
    'reset password' => [function (): string {
        $user = User::factory()->create(['email' => 'asha@example.com']);

        return '/reset-password/'.Password::broker()->createToken($user).'?email=asha@example.com';
    }, false],
    'verify email' => [fn (): string => '/email/verify', true],
    'confirm password' => [fn (): string => '/user/confirm-password', true],
]);

it('shows each page with one h1, no horizontal scroll and no JavaScript errors', function (Closure $path, bool $signedIn, int $width): void {
    $url = $path();

    if ($signedIn) {
        $this->actingAs(User::factory()->unverified()->create());
    }

    visit($url)
        ->resize($width, 800)
        ->assertScript('document.querySelectorAll("h1").length', 1)
        ->assertScript(RECOVERY_NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with('recovery pages')->with([375, 820, 1280]);

it('has no serious accessibility violations', function (Closure $path, bool $signedIn): void {
    $url = $path();

    if ($signedIn) {
        $this->actingAs(User::factory()->unverified()->create());
    }

    visit($url)->assertNoAccessibilityIssues(1);
})->with('recovery pages');
