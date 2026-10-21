<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;

/** 10 §13, 11 §18, 15 §14 item 12: the account pages render, fit the screen and work with the keyboard. */
const ACCOUNT_NO_HORIZONTAL_SCROLL = 'document.documentElement.scrollWidth <= window.innerWidth';

dataset('account widths', [
    'phone 375' => 375,
    'tablet 820' => 820,
    'desktop 1280' => 1280,
]);

it('shows the customer account pages without horizontal scroll or script errors', function (string $path, int $width): void {
    $this->actingAs(User::factory()->create(['name' => 'Asha Rao']));

    visit($path)
        ->resize($width, 800)
        ->assertScript('document.querySelectorAll("h1").length', 1)
        ->assertScript('document.querySelector("[data-test=account-nav] [aria-current=page]") !== null')
        ->assertScript(ACCOUNT_NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with(['/account/profile', '/account/security', '/account/preferences'])->with('account widths');

it('shows the staff account pages with the two-factor section in the nav', function (string $path, int $width): void {
    $this->actingAs(User::factory()->admin()->create(['name' => 'Ada Admin']));

    visit($path)
        ->resize($width, 800)
        ->assertSee('Two-factor')
        ->assertScript('document.querySelector("[data-test=account-nav] [aria-current=page]") !== null')
        ->assertScript(ACCOUNT_NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with(['/admin/account/profile', '/admin/account/security', '/admin/account/preferences', '/admin/account/two-factor'])->with('account widths');

it('reaches the account from the account menu and the phone tab bar', function (): void {
    $this->actingAs(User::factory()->create());

    visit('/dashboard')
        ->resize(375, 800)
        ->assertScript('document.querySelector("[data-test=mobile-tab-bar] a[href=\"/account/profile\"]") !== null')
        ->assertNoJavaScriptErrors();
});

// The save itself (a PUT) is covered by tests/Feature/Account/PreferencesTest: in this browser runner a non-GET Inertia visit
// never gets its response back (the logout button hangs the same way), so the test stops at the unsaved form.
it('follows the system with the length unit and chooses the time zone from a searchable list', function (): void {
    $this->actingAs(User::factory()->create(['unit_system' => 'metric', 'length_unit' => 'cm', 'timezone' => 'Asia/Kolkata']));

    visit('/account/preferences')
        ->resize(1280, 800)
        ->click('[data-test=system-imperial]')
        ->assertScript('document.querySelector("[data-test=length-unit]").value', 'ftin')
        ->assertSee('Unsaved changes')
        ->click('[data-test=timezone]')
        ->type('[data-slot=command-input]', 'London')
        ->assertScript('document.querySelectorAll("[role=option]").length', 1)
        ->click('[role=option]')
        ->assertScript('document.querySelector("[data-test=timezone]").textContent.includes("Europe/London")')
        ->assertNoJavaScriptErrors();
});
