<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;

/** The two-factor page of the staff (11 §18, 13 §5.10): usable from 375 px up, one h1, accessible. */
const TWO_FACTOR_NO_HORIZONTAL_SCROLL = 'document.documentElement.scrollWidth <= window.innerWidth';

dataset('two-factor pages', [
    'enrolment shut the admin area' => [function (): string {
        test()->actingAs(User::factory()->owner()->withoutTwoFactor()->create(['name' => 'Olga Owner']));

        return '/admin/account/two-factor';
    }],
    'on for an admin' => [function (): string {
        test()->actingAs(User::factory()->admin()->create(['name' => 'Ada Admin']));

        return '/admin/account/two-factor';
    }],
    'on for an estimator' => [function (): string {
        test()->actingAs(User::factory()->estimator()->withTwoFactor()->create(['name' => 'Eli Estimator']));

        return '/admin/account/two-factor';
    }],
]);

it('shows each state with one h1, no horizontal scroll and no JavaScript errors', function (Closure $path, int $width): void {
    visit($path())
        ->resize($width, 800)
        ->assertScript('document.querySelectorAll("h1").length', 1)
        ->assertScript(TWO_FACTOR_NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with('two-factor pages')->with([375, 820, 1280]);

it('has no serious accessibility violations', function (Closure $path): void {
    visit($path())->assertNoAccessibilityIssues(1);
})->with('two-factor pages');

it('offers Disable to a role that may switch it off', function (): void {
    test()->actingAs(User::factory()->estimator()->withTwoFactor()->create());

    visit('/admin/account/two-factor')->assertPresent('[data-test="disable-button"]');
});

it('does not offer Disable to an admin, who can still regenerate the recovery codes', function (): void {
    test()->actingAs(User::factory()->admin()->create());

    visit('/admin/account/two-factor')->assertMissing('[data-test="disable-button"]')->assertPresent('[data-test="regenerate-button"]');
});
