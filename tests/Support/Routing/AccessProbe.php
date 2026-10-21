<?php

declare(strict_types=1);

namespace Tests\Support\Routing;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use App\Http\Middleware\EnsureUserType;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Auth\Middleware\RedirectIfAuthenticated;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Routing\Router;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use LogicException;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

/**
 * Checks one entry of the route access map (13 §20.1) against the app: the middleware the audience needs,
 * and for a parameterless GET route what a guest, a customer and the staff actually get. Run from a Pest
 * test, which provides the HTTP client.
 */
final class AccessProbe
{
    public function __construct(private readonly TestCase $test) {}

    /**
     * @param  array{audience: string, permission: ?string, gate: ?string}  $entry
     */
    public function check(string $name, array $entry): void
    {
        $route = Route::getRoutes()->getByName($name);

        if (! $route instanceof LaravelRoute) {
            $this->test->fail("{$name}: the map lists a route that does not exist.");
        }

        $this->checkMiddleware($name, $entry['audience'], $route);

        if (! in_array('GET', $route->methods(), true) || str_contains($route->uri(), '{')) {
            return;
        }

        match ($entry['audience']) {
            'guest' => $this->checkGuest($name),
            'customer' => $this->checkCustomer($name),
            'staff' => $this->checkStaff($name, $entry['permission'], $entry['gate']),
            'any' => $this->checkAny($name),
            'public' => $this->checkPublic($name),
            'webhook' => null,
            default => throw new LogicException("{$name}: unknown audience [{$entry['audience']}]."),
        };
    }

    private function checkMiddleware(string $name, string $audience, LaravelRoute $route): void
    {
        $has = static function (string $class) use ($route): bool {
            foreach (app(Router::class)->gatherRouteMiddleware($route) as $middleware) {
                if (is_string($middleware) && str_starts_with($middleware, $class)) {
                    return true;
                }
            }

            return false;
        };

        $expected = match ($audience) {
            'guest' => $has(RedirectIfAuthenticated::class),
            'customer' => $has(Authenticate::class) && $has(EnsureUserType::class.':customer'),
            'staff' => $has(Authenticate::class) && $has(EnsureUserType::class.':staff'),
            'any' => $has(Authenticate::class) && ! $has(EnsureUserType::class),
            'public' => ! $has(Authenticate::class) && ! $has(EnsureUserType::class) && ! $has(RedirectIfAuthenticated::class),
            'webhook' => ! $has(Authenticate::class) && ! $has(StartSession::class),
            default => throw new LogicException("{$name}: unknown audience [{$audience}]."),
        };

        $this->assert($expected, "{$name}: its middleware does not match the audience [{$audience}].");
    }

    private function checkGuest(string $name): void
    {
        $this->assert($this->get($name)->getStatusCode() < 400, "{$name}: a guest cannot open it.");
        $this->assert($this->get($name, User::factory()->create())->isRedirect(), "{$name}: a signed-in customer is not redirected away.");
        $this->assert($this->get($name, User::factory()->owner()->create())->isRedirect(), "{$name}: a signed-in owner is not redirected away.");
    }

    private function checkCustomer(string $name): void
    {
        $this->assert($this->redirectsTo($this->get($name), route('login')), "{$name}: a guest is not sent to login.");
        $this->assert($this->redirectsTo($this->get($name, User::factory()->owner()->create()), route('admin.dashboard')), "{$name}: staff are not sent to the admin dashboard.");
        $this->assert($this->reached($this->get($name, User::factory()->create())), "{$name}: a customer cannot open it.");
    }

    private function checkStaff(string $name, ?string $permission, ?string $gate): void
    {
        $this->assert($this->redirectsTo($this->get($name), route('login')), "{$name}: a guest is not sent to login.");
        $this->assert($this->get($name, User::factory()->create())->getStatusCode() === 403, "{$name}: a customer does not get 403.");
        $this->assert($this->reached($this->get($name, User::factory()->owner()->create())), "{$name}: an owner cannot open it.");

        if ($permission === null && $gate === null) {
            $this->assert($this->reached($this->get($name, User::factory()->support()->create())), "{$name}: a support user cannot open it.");

            return;
        }

        $role = $this->staffRoleWithout($name, $permission);

        $this->assert(
            $this->get($name, User::factory()->staff($role)->create())->getStatusCode() === 403,
            "{$name}: a {$role->value} lacking [".($permission ?? $gate).'] does not get 403.',
        );
    }

    private function checkAny(string $name): void
    {
        $this->assert($this->redirectsTo($this->get($name), route('login')), "{$name}: a guest is not sent to login.");
        $this->assert($this->reached($this->get($name, User::factory()->create())), "{$name}: a customer cannot open it.");
    }

    private function checkPublic(string $name): void
    {
        $this->assert($this->reached($this->get($name)), "{$name}: a guest cannot open it.");
    }

    /** A staff role other than the owner that does not hold the permission (the owner gates are the owner's alone). */
    private function staffRoleWithout(string $name, ?string $permission): StaffRole
    {
        foreach (StaffRole::cases() as $role) {
            if ($role === StaffRole::Owner) {
                continue;
            }

            $holds = $permission !== null && in_array(PermissionName::from($permission), $role->permissions(), true);

            if (! $holds) {
                return $role;
            }
        }

        throw new LogicException("{$name}: every non-owner role holds [{$permission}], so there is no role to test the denial with.");
    }

    /** @return TestResponse<Response> */
    private function get(string $name, ?User $user = null): TestResponse
    {
        Auth::forgetGuards();
        $this->test->flushSession();

        if ($user instanceof User) {
            $this->test->actingAs($user);
        }

        return $this->test->get(route($name));
    }

    /**
     * Opened, not bounced to the login page.
     *
     * @param  TestResponse<Response>  $response
     */
    private function reached(TestResponse $response): bool
    {
        return $response->getStatusCode() < 400 && ! $this->redirectsTo($response, route('login'));
    }

    /** @param  TestResponse<Response>  $response */
    private function redirectsTo(TestResponse $response, string $url): bool
    {
        return $response->isRedirect($url);
    }

    private function assert(bool $condition, string $message): void
    {
        $this->test->assertTrue($condition, $message);
    }
}
