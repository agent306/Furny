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

    // 10 §4.7, 13 §5.10: the challenge staff with a second factor meet after the password.
    'two_factor' => [
        'title' => 'Two-factor authentication',
        'description' => 'Enter the 6-digit code from your authenticator app to finish signing in.',
        'recovery_description' => 'Enter one of the recovery codes you saved when you set up two-factor authentication. Each one works once.',
        'code' => '6-digit code',
        'recovery_code' => 'Recovery code',
        'use_recovery' => 'Use a recovery code',
        'use_code' => 'Use an authenticator code',
        'submit' => 'Continue',
        'lost_help' => 'Lost your authenticator and your recovery codes? Please ask an owner to reset it for you.',
    ],

    // 10 §4.2, §4.3. The caption sits under the Google button: pressing it is accepting the terms (13 §5.3).
    'google' => [
        'continue' => 'Continue with Google',
        'caption' => 'By continuing you accept the <terms>Terms of service</terms> and <privacy>Privacy policy</privacy>.',
        'or' => 'or',
    ],

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

    // 10 §4.2, §4.3: the way to the phone sign-in, under the email forms.
    'use_phone' => 'Use my phone instead',

    // 10 §4.4: step 1 of the phone sign-in and sign-up.
    'phone' => [
        'title' => 'Sign in with your phone',
        'title_register' => 'Sign up with your phone',
        'description' => "We'll send a 6-digit code by WhatsApp or SMS.",
        'number' => 'Phone number',
        'name' => 'Full name',
        'send' => 'Send code',
        'use_email' => 'Use email instead',
    ],

    // 10 §4.4: step 2, the code (also the code field of the re-authentication page).
    'otp' => [
        'title' => 'Enter your code',
        'sent' => 'We sent a code to {phone} via {channel, select, whatsapp {WhatsApp} other {SMS}}.',
        'code' => '6-digit code',
        'verify' => 'Verify',
        'resend_in' => 'You can ask for a new code in {seconds, plural, one {# second} other {# seconds}}.',
        'resend_whatsapp' => 'Resend on WhatsApp',
        'resend_sms' => 'Send by SMS',
        'change_number' => 'Change number',
        'fallback' => "We couldn't reach you on WhatsApp, so we sent an SMS instead.",
    ],

    // 10 §4.4: step 3, the name of a new customer.
    'complete' => [
        'title' => 'Almost there',
        'description' => 'Your number {phone} is verified. What should we call you?',
        'name' => 'Full name',
        'submit' => 'Create account',
    ],

    // 10 §4.8, 13 §6.4: confirming who is at the keyboard without a password.
    'reauth' => [
        'title' => 'Confirm it is you',
        'description' => 'This is a secure action. Confirm your identity before continuing.',
        'send' => 'Send me a code',
        'to_phone' => 'The code goes to {phone}.',
        'sent' => 'We sent a code {channel, select, whatsapp {by WhatsApp} other {by SMS}} to {phone}.',
        'code' => '6-digit code',
        'confirm' => 'Confirm',
        'nothing' => 'There is no way to confirm your identity on this account. Please contact us.',
    ],

    // 10 §4.8
    'confirm' => [
        'title' => 'Confirm your password',
        'description' => 'This is a secure area. Please confirm your password before continuing.',
        'password' => 'Password',
        'submit' => 'Confirm',
    ],
];
