<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Domain\Identity\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Support\Timebox;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Fortify;

/**
 * `Fortify::authenticateUsing` (13 §2). A wrong email, a wrong password, a user without a password and a
 * soft-deleted user all end the same way (`null`, which Fortify turns into `auth.failed`); only someone who proves
 * the password of a deactivated account is told so, so the message tells nobody which emails exist.
 */
final class AuthenticateUser
{
    /** @throws ValidationException when the password is right but the account is not active */
    public static function handle(Request $request): ?User
    {
        // Every way out takes the same minimum time, the exceptions of the inactive path included.
        return (new Timebox)->call(
            static fn (): ?User => self::authenticate($request),
            (int) config('auth.login_timebox_microseconds'),
        );
    }

    /** The login email, trimmed and lower-cased; null when it is missing or not text. */
    public static function email(Request $request): ?string
    {
        $email = $request->input(Fortify::username());

        if (! is_string($email)) {
            return null;
        }

        $email = mb_strtolower(trim($email));

        return $email === '' ? null : $email;
    }

    private static function authenticate(Request $request): ?User
    {
        $email = self::email($request);
        $password = $request->input('password');
        $password = is_string($password) ? $password : '';
        $user = $email === null ? null : User::query()->where('email', $email)->first();

        // Soft-deleted users are left out by the model's scope. Exactly one hash check happens on every path: when
        // there is nobody (or no password) to compare with, it is made against a placeholder, so a wrong email
        // costs what a wrong password costs.
        $matches = Hash::check($password, $user->password ?? self::placeholderHash()) && $password !== '';

        if ($user === null || $user->password === null || ! $matches) {
            return null;
        }

        if (! $user->is_active) {
            throw ValidationException::withMessages([Fortify::username() => [__('auth.inactive')]]);
        }

        return $user;
    }

    /**
     * A hash of a random value made with the configured hasher. It is made once, ever, and kept in the cache: php-fpm
     * forgets statics after each request, and making a hash per request would itself tell the two cases apart.
     */
    private static function placeholderHash(): string
    {
        return Cache::rememberForever(
            'auth:placeholder-hash:'.md5((string) json_encode(config('hashing'))),
            static fn (): string => Hash::make(Str::random(32)),
        );
    }
}
