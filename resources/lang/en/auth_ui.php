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

    // Shared by the auth forms.
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
];
