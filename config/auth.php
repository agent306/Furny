<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;

return [

    /*
    |--------------------------------------------------------------------------
    | Authentication Defaults
    |--------------------------------------------------------------------------
    |
    | This option defines the default authentication "guard" and password
    | reset "broker" for your application. You may change these values
    | as required, but they're a perfect start for most applications.
    |
    */

    'defaults' => [
        'guard' => env('AUTH_GUARD', 'web'),
        'passwords' => env('AUTH_PASSWORD_BROKER', 'users'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Authentication Guards
    |--------------------------------------------------------------------------
    |
    | Next, you may define every authentication guard for your application.
    | Of course, a great default configuration has been defined for you
    | which utilizes session storage plus the Eloquent user provider.
    |
    | All authentication guards have a user provider, which defines how the
    | users are actually retrieved out of your database or other storage
    | system used by the application. Typically, Eloquent is utilized.
    |
    | Supported: "session"
    |
    */

    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'users',
            // The remember cookie lasts 14 days (13 §6.1). Read when the guard is built, so it is not set in a
            // service provider: that would build the session store while the app boots.
            'remember' => 20160,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | User Providers
    |--------------------------------------------------------------------------
    |
    | All authentication guards have a user provider, which defines how the
    | users are actually retrieved out of your database or other storage
    | system used by the application. Typically, Eloquent is utilized.
    |
    | If you have multiple user tables or models you may configure multiple
    | providers to represent the model / table. These providers may then
    | be assigned to any extra authentication guards you have defined.
    |
    | Supported: "database", "eloquent"
    |
    */

    'providers' => [
        'users' => [
            'driver' => 'eloquent',
            'model' => env('AUTH_MODEL', User::class),
        ],

        // 'users' => [
        //     'driver' => 'database',
        //     'table' => 'users',
        // ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Resetting Passwords
    |--------------------------------------------------------------------------
    |
    | These configuration options specify the behavior of Laravel's password
    | reset functionality, including the table utilized for token storage
    | and the user provider that is invoked to actually retrieve users.
    |
    | The expiry time is the number of minutes that each reset token will be
    | considered valid. This security feature keeps tokens short-lived so
    | they have less time to be guessed. You may change this as needed.
    |
    | The throttle setting is the number of seconds a user must wait before
    | generating more password reset tokens. This prevents the user from
    | quickly generating a very large amount of password reset tokens.
    |
    */

    'passwords' => [
        'users' => [
            'provider' => 'users',
            'table' => env('AUTH_PASSWORD_RESET_TOKEN_TABLE', 'password_reset_tokens'),
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Email Verification Link
    |--------------------------------------------------------------------------
    |
    | The number of minutes a signed verification link works (13 §2, §13). The verification notification reads it.
    |
    */

    'verification' => [
        'expire' => 60,
    ],

    /*
    |--------------------------------------------------------------------------
    | Login time box
    |--------------------------------------------------------------------------
    |
    | Every login attempt takes at least this long, whether the email exists, the password is right or the
    | account is inactive, so the time it takes says nothing about the account (13 §2). Microseconds, as the
    | framework's own guard uses it. Tests set it to 0.
    |
    */

    'login_timebox_microseconds' => 200_000,

    /*
    |--------------------------------------------------------------------------
    | Password reset time box
    |--------------------------------------------------------------------------
    |
    | A request for a reset link takes at least this long, whether the email has an account, the link was sent or
    | the hourly limit swallowed the request, so the time it takes says nothing about the account (13 §5.5). The
    | mail is sent while the request waits, so this is longer than the login box. Microseconds. Tests set it to 0.
    |
    */

    'password_reset_timebox_microseconds' => 1_500_000,

    /*
    |--------------------------------------------------------------------------
    | Password Confirmation Timeout
    |--------------------------------------------------------------------------
    |
    | The number of seconds a password confirmation counts for before the user is asked again: 10 minutes (13 §2,
    | §6.4).
    |
    */

    'password_timeout' => env('AUTH_PASSWORD_TIMEOUT', 600),

];
