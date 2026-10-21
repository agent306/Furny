<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Http\Middleware\HandleInertiaRequests;
use App\Support\Http\ErrorPage;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function (): void {
    Route::middleware('web')->group(function (): void {
        Route::get('/_abort/{status}', fn (int $status) => abort($status, 'secret internal reason'))->whereNumber('status');
        Route::get('/_boom', fn () => throw new RuntimeException('SQLSTATE secret-db-host password=hunter2'));
    });
});

it('renders the Error page for an unknown url', function (): void {
    $this->get('/definitely-missing')
        ->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Error')
            ->where('status', 404));
});

it('renders the Error page for every handled status', function (int $status): void {
    $this->get("/_abort/{$status}")
        ->assertStatus($status)
        ->assertInertia(fn (Assert $page) => $page
            ->component('Error')
            ->where('status', $status));
})->with([403, 404, 405, 419, 429, 503]);

it('never puts the exception message into the page', function (int $status): void {
    $response = $this->get("/_abort/{$status}")->assertStatus($status);

    expect(json_encode($response->viewData('page'), JSON_THROW_ON_ERROR))->not->toContain('secret internal reason')
        ->and($response->getContent())->not->toContain('secret internal reason');
})->with([403, 404, 405, 419, 429, 503]);

it('answers an Inertia visit with the Error page as json, status kept', function (): void {
    $this->get('/_abort/403', ['X-Inertia' => 'true', 'X-Inertia-Version' => (string) app(HandleInertiaRequests::class)->version(request())])
        ->assertForbidden()
        ->assertHeader('X-Inertia', 'true')
        ->assertJsonPath('component', 'Error')
        ->assertJsonPath('props.status', 403);
});

it('renders the Error page for a server error when debug is off, without leaking anything', function (): void {
    config(['app.debug' => false]);

    $response = $this->get('/_boom')
        ->assertStatus(500)
        ->assertInertia(fn (Assert $page) => $page
            ->component('Error')
            ->where('status', 500));

    $page = json_encode($response->viewData('page'), JSON_THROW_ON_ERROR);

    foreach (['SQLSTATE', 'secret-db-host', 'hunter2', 'RuntimeException', 'HandleInertiaRequests', '.php', 'trace'] as $needle) {
        expect($page)->not->toContain($needle)
            ->and($response->getContent())->not->toContain($needle);
    }

    // The Error page's own props are the status and nothing else.
    expect($response->viewData('page')['props']['status'])->toBe(500)
        ->and(array_keys($response->viewData('page')['props']))->not->toContain('exception', 'message', 'trace');
});

it('keeps the framework debug page for a server error when debug is on', function (): void {
    config(['app.debug' => true]);

    $response = $this->get('/_boom')->assertStatus(500);

    expect($response->getContent())->toContain('secret-db-host')
        ->and($response->headers->get('X-Inertia'))->toBeNull();
});

it('leaves json requests and the api alone', function (): void {
    config(['app.debug' => false]);

    $this->getJson('/_abort/403')->assertForbidden()->assertJsonMissingPath('component');
    $this->getJson('/definitely-missing')->assertNotFound()->assertJsonMissingPath('component');
    $this->getJson('/_boom')->assertStatus(500)->assertJsonMissingPath('component');
});

it('keeps the headers that clients act on', function (): void {
    Route::middleware('web')->get('/_busy', fn () => abort(503, headers: ['Retry-After' => '60']));
    Route::middleware('web')->get('/_throttled', fn () => abort(429, headers: ['Retry-After' => '12', 'X-RateLimit-Remaining' => '0']));

    $this->get('/_busy')->assertStatus(503)->assertHeader('Retry-After', '60');
    $this->get('/_throttled')->assertStatus(429)->assertHeader('Retry-After', '12')->assertHeader('X-RateLimit-Remaining', '0');
});

it('shares the audience props with an error raised inside the web group', function (): void {
    $this->actingAs(User::factory()->create(['name' => 'Asha Rao']))
        ->get('/_abort/403')
        ->assertInertia(fn (Assert $page) => $page
            ->component('Error')
            ->where('auth.user.name', 'Asha Rao')
            ->has('business.name')
            ->has('i18n.hash'));
});

it('renders an unmatched url inside the web group for a guest, with the shared props', function (): void {
    $this->get('/definitely-missing')
        ->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Error')
            ->where('auth.user', null)
            ->has('app.name')
            ->has('business.name')
            ->has('i18n.hash'));
});

it('gives a signed-in user their own session and layout props on an unmatched url', function (): void {
    $this->actingAs(User::factory()->create(['name' => 'Asha Rao']))
        ->get('/definitely-missing')
        ->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Error')
            ->where('status', 404)
            ->where('auth.user.name', 'Asha Rao')
            ->where('auth.user.type', 'customer'));

    $this->actingAs(User::factory()->admin()->create())
        ->get('/also/not/there')
        ->assertInertia(fn (Assert $page) => $page->where('auth.user.type', 'staff'));
});

it('registers the fallback as the one named catch-all, and only the fallback answers unmatched urls', function (): void {
    expect(Route::getRoutes()->getByName('fallback')?->isFallback)->toBeTrue()
        ->and(route('welcome', absolute: false))->toBe('/');
});

it('puts the Error page props through the shared props for a failure raised before they were shared', function (): void {
    // CSRF and other early web middleware fail before HandleInertiaRequests ran.
    Route::middleware('web')->get('/_early', fn () => abort(419));

    $this->get('/_early')->assertStatus(419)->assertInertia(fn (Assert $page) => $page->has('auth')->has('i18n.hash'));
});

it('reports a failure to render the Error page and falls back to the original response', function (): void {
    Exceptions::fake();
    Inertia::setRootView('missing-root-view');
    $original = new Response('forbidden', 403);

    $result = ErrorPage::render($original, new RuntimeException('boom'), Request::create('/somewhere'));

    expect($result)->toBe($original);
    Exceptions::assertReported(InvalidArgumentException::class);
});

it('does not turn redirects or validation failures into error pages', function (): void {
    $this->get(route('customer.dashboard'))->assertRedirect(route('login'));
});

it('answers a missing asset or api path with a bare 404: no Inertia page, no session, no cookie', function (string $path): void {
    $response = $this->get($path)->assertNotFound();

    expect($response->headers->getCookies())->toBe([])
        ->and($response->headers->has('Set-Cookie'))->toBeFalse()
        ->and($response->headers->has('X-Inertia'))->toBeFalse()
        ->and($response->getContent())->not->toContain('data-page');
})->with(['/build/assets/x.js', '/build/missing', '/some/where/missing.css', '/favicon-gone.ico', '/api/nope', '/api/v1/deep/nope']);

it('answers a missing api path with json', function (): void {
    $this->get('/api/nope')->assertNotFound()->assertExactJson(['message' => 'Not Found']);
});

it('does not turn real page routes or extension-less unknown urls into bare 404s', function (): void {
    $this->get('/manifest.webmanifest')->assertOk();
    $this->get('/definitely-missing')->assertNotFound()->assertInertia(fn (Assert $page) => $page->component('Error'));
    $this->get('/terms')->assertOk();
});

it('renders a POST to an unmatched url as the 405 Error page', function (): void {
    $this->actingAs(User::factory()->create(['name' => 'Asha Rao']))
        ->post('/definitely-missing')
        ->assertStatus(405)
        ->assertInertia(fn (Assert $page) => $page
            ->component('Error')
            ->where('status', 405)
            ->has('app.name')
            ->has('i18n.hash'));
});

it('has no closure route actions in the application routes, so route:cache works', function (): void {
    $closures = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route) => $route->getAction('uses') instanceof Closure)
        ->filter(function ($route): bool {
            $file = (new ReflectionFunction($route->getAction('uses')))->getFileName();

            return is_string($file) && ! str_contains($file, '/vendor/') && ! str_contains($file, '/tests/');
        })
        ->map(fn ($route): string => $route->uri())
        ->values()
        ->all();

    expect($closures)->toBe([]);
});
