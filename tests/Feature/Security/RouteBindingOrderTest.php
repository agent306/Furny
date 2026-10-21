<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Routing\AccessStubs;

/*
| Route model binding must not run before the access checks (13 §1): otherwise the status of a response to a
| customer, an inactive user or an unenrolled admin would tell them whether a record exists.
*/

beforeEach(function (): void {
    AccessStubs::register();

    Route::middleware(AccessStubs::ADMIN)->get('/admin/_bound/{user}', static fn (User $user): string => $user->id);
    Route::middleware(AccessStubs::CUSTOMER)->get('/_bound/{user}', static fn (User $user): string => $user->id);
    Route::middleware(['web', 'auth', 'active', 'throttle:api'])->get('/_api/_bound/{user}', static fn (User $user): string => $user->id);

    $this->existing = User::factory()->create();
    $this->missing = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
});

it('gives a customer the same 403 on an admin route for an existing and a missing record', function (): void {
    $this->actingAs(User::factory()->create());

    $existing = $this->get("/admin/_bound/{$this->existing->id}")->assertForbidden();
    $missing = $this->get("/admin/_bound/{$this->missing}")->assertForbidden();

    foreach ([$existing, $missing] as $response) {
        $response->assertInertia(fn (Assert $page) => $page->component('Error')->where('status', 403));
    }
});

it('sends staff away from a customer route for an existing and a missing record alike', function (): void {
    $this->actingAs(User::factory()->owner()->create());

    $this->get("/_bound/{$this->existing->id}")->assertRedirectToRoute('admin.dashboard');
    $this->get("/_bound/{$this->missing}")->assertRedirectToRoute('admin.dashboard');
});

it('logs an inactive user out instead of answering 404 for a missing record', function (string $path): void {
    $this->actingAs(User::factory()->inactive()->create());

    $this->get(str_replace('{id}', $this->missing, $path))->assertRedirectToRoute('login');

    $this->assertGuest();
})->with([
    'admin' => '/admin/_bound/{id}',
    'customer' => '/_bound/{id}',
]);

it('logs an inactive user out of the api group before the binding too', function (): void {
    $this->actingAs(User::factory()->inactive()->create())
        ->getJson("/_api/_bound/{$this->missing}")
        ->assertUnauthorized()
        ->assertExactJson(['code' => 'inactive']);
});

it('redirects an unenrolled admin to 2FA before the binding resolves', function (): void {
    $this->actingAs(User::factory()->admin()->withoutTwoFactor()->create());

    $this->get("/admin/_bound/{$this->missing}")->assertRedirectToRoute('admin.security.two-factor');
    $this->get("/admin/_bound/{$this->existing->id}")->assertRedirectToRoute('admin.security.two-factor');
});

it('redirects a customer who has not onboarded before the binding resolves', function (): void {
    $this->actingAs(User::factory()->notOnboarded()->create());

    $this->get("/_bound/{$this->missing}")->assertRedirectToRoute('customer.onboarding.show');
});

it('expires a staff session before the binding resolves', function (): void {
    $this->withSession(['auth.login_at' => now()->subHours(13)->getTimestamp()])
        ->actingAs(User::factory()->estimator()->create());

    $this->get("/admin/_bound/{$this->missing}")->assertRedirectToRoute('login');
});

it('still resolves the binding for a user who may be there', function (): void {
    $this->actingAs(User::factory()->estimator()->create());

    $this->get("/admin/_bound/{$this->existing->id}")->assertOk()->assertSee($this->existing->id);
    $this->get("/admin/_bound/{$this->missing}")->assertNotFound();
});
