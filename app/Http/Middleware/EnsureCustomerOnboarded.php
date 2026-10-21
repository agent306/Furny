<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `onboarded` (10 §5.1): a customer who has not finished the wizard is sent to it from every page (GET) except
 * the wizard itself, the account pages, help and the notification list. Writes are never redirected.
 */
final class EnsureCustomerOnboarded
{
    /** Route name patterns that stay open to a customer who has not onboarded. */
    public const array EXEMPT = [
        'customer.onboarding.*',
        'customer.account.*',
        'customer.help',
        'customer.notifications.index',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (
            $user instanceof User
            && $user->isCustomer()
            && $user->onboarded_at === null
            && $request->isMethod('GET')
            && ! $request->routeIs(...self::EXEMPT)
        ) {
            return redirect()->route('customer.onboarding.show');
        }

        return $next($request);
    }
}
