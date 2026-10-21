<?php

declare(strict_types=1);

return [
    // The public welcome page (10 §4.1).
    'welcome' => [
        'title' => 'Welcome',
        'tagline' => 'Design furniture that fits your home perfectly.',
        'features' => [
            'plan' => 'Upload your floor plan or draw it',
            'design' => 'Design custom furniture in 2D and 3D',
            'order' => 'Get a quote and follow production to delivery',
        ],
        'create_account' => 'Create account',
        'log_in' => 'Log in',
    ],

    // Shared by the auth forms. `throttled` is the wait after too many attempts (10 §4), counted down on the page.
    'throttled' => 'Too many attempts. Try again in {seconds, plural, one {# second} other {# seconds}}.',
    'captcha' => 'Check that you are human',
    'password' => [
        'show' => 'Show password',
        'hide' => 'Hide password',
    ],
    'password_rules' => 'At least {min, plural, one {# character} other {# characters}}.',

    // 10 §4.2
    'login' => [
        'title' => 'Log in',
        'description' => 'Welcome back. Enter your email and password.',
        'email' => 'Email address',
        'password' => 'Password',
        'remember' => 'Keep me signed in for 14 days',
        'forgot_password' => 'Forgot password?',
        'submit' => 'Log in',
        'new_here' => 'New here?',
        'create_account' => 'Create an account',
    ],

    // 10 §4.3. The page shows the same sentence as the server answers a refused registration with
    // (`auth.registration_closed`, a Laravel-format file that is not exported to the browser).
    'registration_closed' => 'Registration is closed right now. Please check back later, or log in if you already have an account.',

    'register' => [
        'title' => 'Create your account',
        'description' => 'It takes a minute. Then you can start designing.',
        'name' => 'Full name',
        'email' => 'Email address',
        'password' => 'Password',
        'password_confirmation' => 'Confirm password',
        'terms_before' => 'I accept the',
        'terms_and' => 'and the',
        'marketing_opt_in' => 'Send me occasional updates and offers',
        'submit' => 'Create account',
        'have_account' => 'Already have an account?',
        'log_in' => 'Log in',
    ],

    // 10 §4.5. The answer to the form is `passwords.sent_generic`, a Laravel-format sentence the server sends as `status`.
    'forgot' => [
        'title' => 'Forgot your password?',
        'description' => "Enter your email address and we'll send you a link to choose a new one.",
        'email' => 'Email address',
        'submit' => 'Email reset link',
        'back_to_login' => 'Back to log in',
    ],

    'reset' => [
        'title' => 'Choose a new password',
        'description' => 'Enter a new password for your account.',
        'email' => 'Email address',
        'password' => 'New password',
        'password_confirmation' => 'Confirm new password',
        'submit' => 'Reset password',
        'request_new' => 'Request a new link',
    ],

    // 10 §4.6
    'verify' => [
        'title' => 'Verify your email',
        'description' => 'We sent a verification link to {email}. Open it to finish.',
        'resent' => 'A new verification link is on its way to {email}.',
        'resend' => 'Resend email',
        'continue' => 'Continue to the app',
    ],

    // 10 §4.8. The re-authentication page of passwordless users comes with the phone sign-in.
    'confirm' => [
        'title' => 'Confirm your password',
        'description' => 'This is a secure area. Please confirm your password before continuing.',
        'password' => 'Password',
        'submit' => 'Confirm',
    ],
];
