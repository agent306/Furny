<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

/** 15 §14 item 12: usable from 320 px up, never a horizontal page scroll. */
const NO_HORIZONTAL_SCROLL = 'document.documentElement.scrollWidth <= window.innerWidth';

dataset('widths', [
    'phone 375' => 375,
    'tablet 820' => 820,
    'desktop 1280' => 1280,
]);

it('shows the welcome page without horizontal scroll', function (int $width): void {
    visit('/')
        ->resize($width, 800)
        ->assertSee('Design furniture that fits your home perfectly.')
        ->assertScript(NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with('widths');

it('shows the customer dashboard without horizontal scroll', function (int $width): void {
    $this->actingAs(User::factory()->create(['name' => 'Asha Rao']));

    visit('/dashboard')
        ->resize($width, 800)
        ->assertSee('Hello, Asha Rao')
        ->assertScript(NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with('widths');

it('shows the admin dashboard without horizontal scroll', function (int $width): void {
    $this->actingAs(User::factory()->admin()->create());

    visit('/admin')
        ->resize($width, 800)
        ->assertSee('Your work queue will appear here')
        ->assertScript(NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with('widths');

it('shows the legal, error and kit auth pages without horizontal scroll', function (string $path, int $width): void {
    visit($path)
        ->resize($width, 800)
        ->assertScript(NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with(['/terms', '/privacy', '/definitely-missing', '/login', '/register'])->with('widths');

it('has one h1 per page', function (string $path, bool $signedIn): void {
    if ($signedIn) {
        $this->actingAs(User::factory()->create());
    }

    visit($path)->assertScript('document.querySelectorAll("h1").length', 1);
})->with([
    'welcome' => ['/', false],
    'terms' => ['/terms', false],
    'privacy' => ['/privacy', false],
    'error page' => ['/definitely-missing', false],
    'login (kit page in the new AuthLayout)' => ['/login', false],
    'dashboard' => ['/dashboard', true],
    'terms, signed in' => ['/terms', true],
]);

it('shows the skip link when it is focused, and it targets the main region', function (): void {
    $this->actingAs(User::factory()->create());

    $page = visit('/dashboard')->resize(1280, 800);

    $page->script('document.querySelector("[data-test=skip-link]").focus()');

    $page->assertScript('document.activeElement.getAttribute("data-test")', 'skip-link')
        ->assertScript('document.querySelector("[data-test=skip-link]").getBoundingClientRect().width > 1')
        ->assertScript('document.querySelector("[data-test=skip-link]").getAttribute("href")', '#main')
        ->assertScript('document.getElementById("main") !== null');
});

it('shows the phone tab bar at 375 px and hides it from 820 px, every tab 44 px or more', function (): void {
    $this->actingAs(User::factory()->create());

    visit('/dashboard')
        ->resize(375, 800)
        ->assertScript('getComputedStyle(document.querySelector("[data-test=mobile-tab-bar]")).display !== "none"')
        ->assertScript('[...document.querySelectorAll("[data-test=mobile-tab-bar] a")].every((a) => a.getBoundingClientRect().height >= 44 && a.getBoundingClientRect().width >= 44)');

    visit('/dashboard')
        ->resize(820, 800)
        ->assertScript('getComputedStyle(document.querySelector("[data-test=mobile-tab-bar]")).display === "none"');
});

it('has no serious accessibility violations on the public and dashboard pages', function (string $path): void {
    $this->actingAs(User::factory()->admin()->create());

    visit($path)->assertNoAccessibilityIssues(1);
})->with(['/', '/terms', '/privacy', '/admin']);

it('shows a flash toast once and does not replay it on Back', function (): void {
    Route::middleware(['web', 'auth'])->get('/_flashed', function () {
        Inertia::flash('success', 'Saved for real.');

        return redirect('/dashboard');
    });
    $this->actingAs(User::factory()->create());

    $page = visit('/_flashed')->resize(1280, 800);

    $page->assertSee('Saved for real.');

    // Count every toast added from now on, then leave and come Back.
    $page->script('window.__toasts = 0; new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1 && (n.matches("[data-sonner-toast]") || n.querySelector("[data-sonner-toast]"))) window.__toasts++; }))).observe(document.body, { childList: true, subtree: true })');
    $page->click('Terms')->wait(1);
    $page->assertScript('location.pathname', '/terms');
    $page->script('history.back()');
    $page->wait(1);

    $page->assertScript('location.pathname', '/dashboard')
        ->assertScript('window.__toasts', 0);
});

it('moves focus to the heading and announces the page after an Inertia navigation, also across layouts', function (): void {
    $this->actingAs(User::factory()->create());

    $page = visit('/dashboard')->resize(1280, 800);

    $page->click('Terms')->wait(1);
    $page->assertScript('document.activeElement === document.querySelector("#main h1")')
        ->assertScript('document.querySelector("[data-test=route-announcer]").textContent.trim().startsWith("Terms of service")');
});
