<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use App\Support\Settings\SettingsGroup;
use Inertia\Testing\AssertableInertia as Assert;

function renameBusiness(string $name): void
{
    $settings = app(Settings::class);
    $business = $settings->business();
    $business->name = $name;
    $settings->put(SettingsGroup::Business, $business);
}

it('renders the legal pages with the business name and the last update date', function (string $route, string $component): void {
    renameBusiness('Acme Woodworks');

    $this->get(route($route))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component($component)
            ->where('businessName', 'Acme Woodworks')
            ->where('updatedOn', '2026-10-20'));
})->with([
    'terms' => ['legal.terms', 'Legal/Terms'],
    'privacy' => ['legal.privacy', 'Legal/Privacy'],
]);

it('uses the documented paths', function (): void {
    expect(route('legal.terms', absolute: false))->toBe('/terms')
        ->and(route('legal.privacy', absolute: false))->toBe('/privacy');
});

it('is public for guests, customers and staff', function (string $route): void {
    $this->get(route($route))->assertOk();
    $this->actingAs(User::factory()->create())->get(route($route))->assertOk();
    $this->actingAs(User::factory()->admin()->create())->get(route($route))->assertOk();
})->with(['legal.terms', 'legal.privacy']);

it('keeps the business placeholder in the translated bodies, one ICU message each', function (string $key): void {
    $body = trans($key);

    expect($body)->toBeString()
        ->and($body)->toContain('{business}')
        ->and(MessageFormatter::formatMessage('en', $body, ['business' => 'Acme']))->toContain('Acme')
        // Paragraphs are separated by a blank line; the page splits on it. No markup.
        ->and($body)->toContain("\n\n")
        ->and($body)->not->toMatch('/<[a-z]/i');
})->with(['legal.terms.body', 'legal.privacy.body']);

it('passes the business name through untouched, escaping is the page job', function (): void {
    renameBusiness('<b>Acme</b> & Sons');

    $this->get(route('legal.terms'))
        ->assertInertia(fn (Assert $page) => $page->where('businessName', '<b>Acme</b> & Sons'));
});
