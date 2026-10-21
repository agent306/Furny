<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use Closure;
use Illuminate\Http\Request;

/**
 * Login pipeline step (13 §2): staff never get a remember cookie, whatever the form says. Customers keep the
 * choice they made. Looking the user up here says nothing to the visitor: the flag only changes what happens after
 * a successful login.
 */
final class ApplyRememberPolicy
{
    public function handle(Request $request, Closure $next): mixed
    {
        $email = AuthenticateUser::email($request);

        if ($email !== null && User::query()->where('email', $email)->where('type', UserType::Staff->value)->exists()) {
            $request->merge(['remember' => false]);
        }

        return $next($request);
    }
}
