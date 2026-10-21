<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionKey;
use Illuminate\Support\Facades\Redis;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\RegistryFixtures;

afterEach(function (): void {
    RegistryFixtures::clean(...($this->users ?? []));
});

/**
 * Opens two sessions for the user, the first an hour ago.
 *
 * @return array{string, string} the id of the current (newer) session and the id of the other
 */
function openTwoSessions(User $user): array
{
    $other = RegistryFixtures::open($user);
    $hourAgo = now()->subHour()->getTimestamp();
    Redis::connection('sessions')->hset('sess:meta:'.$other, 'last_active_at', (string) $hourAgo);
    Redis::connection('sessions')->zadd('sess:user:'.$user->getKey(), $hourAgo, $other);
    $current = RegistryFixtures::open($user);

    return [$current, $other];
}

it('lists the open sessions with the current one marked', function (): void {
    $user = User::factory()->create();
    $this->users = [$user];
    [$current, $other] = openTwoSessions($user);

    $this->actingAs($user)
        ->withCookie((string) config('session.cookie'), $current)
        ->get(route('customer.account.security'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Customer/Account/Security')
            ->has('sessions', 2)
            ->has('sessions', fn (Assert $sessions) => $sessions
                ->has('0', fn (Assert $row) => $row
                    ->where('id', SessionKey::for($current))
                    ->where('isCurrent', true)
                    ->where('method', 'password')
                    ->hasAll(['uaSummary', 'ipMasked', 'lastActiveAt']))
                ->has('1', fn (Assert $row) => $row
                    ->where('id', SessionKey::for($other))
                    ->where('isCurrent', false)
                    ->etc())));
});

it('never sends a session id', function (): void {
    $user = User::factory()->create();
    $this->users = [$user];
    [$current] = openTwoSessions($user);

    $response = $this->actingAs($user)
        ->withCookie((string) config('session.cookie'), $current)
        ->get(route('customer.account.security'));

    expect($response->getContent())->not->toContain($current);
});

it('mirrors the Google switch and whether Google is linked', function (bool $enabled, bool $linked): void {
    config(['features.google_login' => $enabled]);
    $user = $linked ? User::factory()->googleLinked()->create() : User::factory()->create();

    $this->actingAs($user)
        ->get(route('customer.account.security'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('googleEnabled', $enabled)
            ->where('googleLinked', $linked));
})->with([[true, false], [true, true], [false, false]]);

it('says whether the user has a password', function (): void {
    $this->actingAs(User::factory()->create())
        ->get(route('customer.account.security'))
        ->assertInertia(fn (Assert $page) => $page->where('hasPassword', true));

    $this->actingAs(User::factory()->phoneOnly()->create())
        ->get(route('customer.account.security'))
        ->assertInertia(fn (Assert $page) => $page->where('hasPassword', false));
});

it('renders the staff security page with the same props', function (): void {
    expect(route('admin.account.security', absolute: false))->toBe('/admin/account/security');

    $this->actingAs(User::factory()->support()->create())
        ->get(route('admin.account.security'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Account/Security')
            ->hasAll(['hasPassword', 'googleLinked', 'googleEnabled', 'sessions']));
});

it('keeps each audience out of the other page', function (): void {
    $this->actingAs(User::factory()->create())->get(route('admin.account.security'))->assertForbidden();
    $this->actingAs(User::factory()->support()->create())
        ->get(route('customer.account.security'))
        ->assertRedirectToRoute('admin.dashboard');
});
