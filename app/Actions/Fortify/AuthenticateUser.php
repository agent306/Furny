<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Domain\Identity\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Fortify;

/**
 * `Fortify::authenticateUsing` (13 §2). A wrong email, a wrong password, a user without a password and a
 * soft-deleted user all end the same way (`null`, which Fortify turns into `auth.failed`); only someone who proves
 * the password of a deactivated account is told so, so the message tells nobody which emails exist.
 */
final class AuthenticateUser
{
    private static ?string $placeholderHash = null;

    /** @throws ValidationException when the password is right but the account is not active */
    public static function handle(Request $request): ?User
    {
        $email = self::email($request);
        $password = $request->input('password');
        $user = $email === null ? null : User::query()->where('email', $email)->first();

        // Soft-deleted users are left out by the model's scope. A check against a placeholder hash when there is no
        // password to compare keeps a wrong email from answering faster than a wrong password.
        $matches = is_string($password) && $password !== ''
            && Hash::check($password, $user->password ?? self::placeholderHash());

        if ($user === null || $user->password === null || ! $matches) {
            return null;
        }

        if (! $user->is_active) {
            throw ValidationException::withMessages([Fortify::username() => [__('auth.inactive')]]);
        }

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

    private static function placeholderHash(): string
    {
        return self::$placeholderHash ??= Hash::make(Str::random(32));
    }
}
