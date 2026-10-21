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
    /** Request attribute holding the outcome of the first call, for the second call of the same login. */
    private const string MEMO = 'auth.authenticate_user';

    /** @throws ValidationException when the password is right but the account is not active */
    public static function handle(Request $request): ?User
    {
        // Fortify asks twice for one login: its two-factor step and its authenticate step each call this. The
        // second call gets the answer of the first, so one login costs one hash check and one time box.
        $key = hash('sha256', (string) self::email($request)."\0".(is_string($request->input('password')) ? $request->input('password') : ''));
        $memo = $request->attributes->get(self::MEMO);

        if (is_array($memo) && $memo['key'] === $key) {
            return $memo['user'];
        }

        // Every way out takes the same minimum time, the exceptions of the inactive path included.
        $user = (new Timebox)->call(
            static fn (): ?User => self::authenticate($request),
            (int) config('auth.login_timebox_microseconds'),
        );

        $request->attributes->set(self::MEMO, ['key' => $key, 'user' => $user]);

        return $user;
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
        // costs what a wrong password costs. The placeholder is read every time, so the work does not depend on
        // the email either.
        $placeholder = self::placeholderHash();
        $matches = Hash::check($password, $user->password ?? $placeholder) && $password !== '';

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
