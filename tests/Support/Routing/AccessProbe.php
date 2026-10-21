<?php

declare(strict_types=1);

namespace Tests\Support\Routing;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\User;
use App\Http\Middleware\EnsureUserType;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Auth\Middleware\RedirectIfAuthenticated;
use Illuminate\Auth\Middleware\RequirePassword;
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
    public const array AUDIENCES = ['guest', 'customer', 'staff', 'any', 'public', 'webhook'];

    /**
     * Guest pages that legitimately send a signed-out visitor elsewhere: the 2FA challenge has nothing to
     * challenge without a half-finished login.
     */
    private const array GUEST_REDIRECTS = [
        'two-factor.login' => 'login',
        // The steps of the phone sign-in need what the step before left in the session.
        'auth.otp.verify.show' => 'auth.otp.create',
        'auth.otp.complete.show' => 'auth.otp.create',
    ];

    /** Public routes that read something a visitor must have in their session first: without it they answer 404. */
    private const array PUBLIC_NEEDS_STATE = ['auth.otp.status'];

    /**
     * Public routes that send a visitor on without showing a page: the Google round trip starts with a redirect
     * (here, back with an error, as the visitor did not say what they come for) and ends with one.
     */
    private const array PUBLIC_REDIRECTS = ['auth.google.redirect', 'auth.google.callback'];

    /**
     * Signed-in routes that send a user with a password on without showing a page: re-authentication is for users who
     * have none; the others confirm the password they have.
     */
    private const array ANY_PASSWORD_REDIRECTS = ['auth.reauthenticate' => 'password.confirm'];

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

        $missing = array_values(array_filter(
            $this->requiredStack($name, $audience),
            fn (string $required): bool => ! in_array($required, self::aliasesOf($route), true),
        ));

        $this->assert($missing === [], "{$name}: it lacks the group middleware [".implode(', ', $missing).'] of its audience.');
    }

    /**
     * The full middleware stack of the route group a customer or staff route belongs to (13 §1), as aliases.
     *
     * @return list<string>
     */
    private function requiredStack(string $name, string $audience): array
    {
        $type = match ($audience) {
            'customer' => 'customer',
            'staff' => 'staff',
            default => null,
        };

        if ($type === null) {
            return [];
        }

        return match (true) {
            str_starts_with($name, 'customer.') => AccessStubs::CUSTOMER,
            str_starts_with($name, 'admin.') => AccessStubs::ADMIN,
            str_starts_with($name, 'api.') => ['web', 'auth', 'active', $type, 'throttle:api'],
            default => ['web', 'auth', 'active', $type],
        };
    }

    /**
     * The route's own middleware names without their parameters, except that `throttle:x` keeps its limiter.
     *
     * @return list<string>
     */
    private static function aliasesOf(LaravelRoute $route): array
    {
        return array_values(array_map(
            static fn (mixed $middleware): string => is_string($middleware) && ! str_starts_with($middleware, 'throttle:') ? explode(':', $middleware)[0] : (string) $middleware,
            $route->gatherMiddleware(),
        ));
    }

    private function checkGuest(string $name): void
    {
        $guest = $this->get($name);
        $redirect = self::GUEST_REDIRECTS[$name] ?? null;

        $this->assert(
            $redirect === null ? $this->opened($guest) : $guest->isRedirect(route($redirect)),
            "{$name}: a guest does not get ".($redirect === null ? 'the page.' : "a redirect to {$redirect}."),
        );

        foreach (['customer' => User::factory()->create(), 'owner' => User::factory()->owner()->create()] as $who => $user) {
            $this->assert(
                $this->get($name, $user)->isRedirect(url()->to((string) config('fortify.home'))),
                "{$name}: a signed-in {$who} is not redirected to the home page.",
            );
        }
    }

    private function checkCustomer(string $name): void
    {
        $this->assert($this->redirectsTo($this->get($name), route('login')), "{$name}: a guest is not sent to login.");
        $this->assert($this->redirectsTo($this->get($name, User::factory()->owner()->create()), route('admin.dashboard')), "{$name}: staff are not sent to the admin dashboard.");
        $this->assert($this->opened($this->get($name, User::factory()->create())), "{$name}: a customer does not get the page.");
    }

    private function checkStaff(string $name, ?string $permission, ?string $gate): void
    {
        $this->assert($this->redirectsTo($this->get($name), route('login')), "{$name}: a guest is not sent to login.");
        $this->assert($this->get($name, User::factory()->create())->getStatusCode() === 403, "{$name}: a customer does not get 403.");
        $this->assert($this->opened($this->get($name, User::factory()->owner()->create())), "{$name}: an owner does not get the page.");

        if ($permission === null && $gate === null) {
            $this->assert($this->opened($this->get($name, User::factory()->support()->create())), "{$name}: a support user does not get the page.");

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

        // Unverified, so the verification notice renders for them instead of redirecting away.
        $user = User::factory()->unverified()->create();
        $redirect = self::ANY_PASSWORD_REDIRECTS[$name] ?? null;

        if ($redirect !== null) {
            $this->assert($this->get($name, $user)->isRedirect(route($redirect)), "{$name}: a signed-in customer with a password is not sent to {$redirect}.");
            $this->assert($this->opened($this->get($name, User::factory()->unverified()->passwordless()->create()), $name), "{$name}: a signed-in customer without a password does not get the page.");

            return;
        }

        $this->assert($this->opened($this->get($name, $user), $name), "{$name}: a signed-in customer does not get the page.");
    }

    private function checkPublic(string $name): void
    {
        $guest = $this->get($name);

        if (in_array($name, self::PUBLIC_REDIRECTS, true)) {
            $this->assert($guest->isRedirect(), "{$name}: a guest is not redirected.");

            return;
        }

        if (in_array($name, self::PUBLIC_NEEDS_STATE, true)) {
            $this->assert($guest->getStatusCode() === 404, "{$name}: a visitor without the state it reads does not get a 404.");

            return;
        }

        $this->assert($this->opened($guest), "{$name}: a guest does not get the page.");
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
     * The page itself (2xx), or the password confirmation a route behind `password.confirm` asks for. Any other
     * redirect (login, onboarding, the 2FA page, the dashboard) is not "opened".
     *
     * @param  TestResponse<Response>  $response
     */
    private function opened(TestResponse $response, ?string $routeName = null): bool
    {
        if ($response->isSuccessful()) {
            return true;
        }

        return $routeName !== null
            && $this->behindPasswordConfirmation($routeName)
            && $response->isRedirect(route('password.confirm'));
    }

    private function behindPasswordConfirmation(string $name): bool
    {
        $route = Route::getRoutes()->getByName($name);

        if (! $route instanceof LaravelRoute) {
            return false;
        }

        foreach (app(Router::class)->gatherRouteMiddleware($route) as $middleware) {
            if (is_string($middleware) && str_starts_with($middleware, RequirePassword::class)) {
                return true;
            }
        }

        return false;
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
