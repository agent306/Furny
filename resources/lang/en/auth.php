<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Authentication Language Lines
    |--------------------------------------------------------------------------
    |
    | The following language lines are used during authentication for various
    | messages that we need to display to the user. You are free to modify
    | these language lines according to your application's requirements.
    |
    */

    'failed' => 'These credentials do not match our records.',
    'password' => 'The provided password is incorrect.',
    'throttle' => 'Too many login attempts. Please try again in :seconds seconds.',

    // Access middleware (13 §1): shown once on the login page or the enrolment page.
    'inactive' => 'This account is not active. Contact us if you think this is a mistake.',
    'session_revoked' => 'You were signed out of this device. Please sign in again.',
    'session_expired' => 'Your session has expired. Please sign in again.',
    '2fa_required' => 'Set up two-factor authentication to use the admin area.',

    // Registration and the captcha (13 §3, §5.1).
    'email_unavailable' => "This email can't be used. Try signing in or resetting your password.",
    'name_no_links' => 'Enter your name without web addresses.',
    'terms_required' => 'Accept the terms to create an account.',
    'registration_closed' => 'Registration is closed right now. Please check back later, or log in if you already have an account.',
    'captcha_failed' => "We couldn't confirm you are not a robot. Please try again.",
    'captcha_unavailable' => 'The check that you are not a robot is not available right now. Please try again in a moment.',

    // Error codes of the account flows (13 §5, 10 §13.2).
    'errors' => [
        'last_login_method' => 'You need at least one way to sign in.',

        // Google sign-in (13 §5.3).
        'oauth_cancelled' => 'Google sign-in was cancelled. You can try again or use another way to sign in.',
        'oauth_state_invalid' => 'That sign-in attempt has expired. Please try again.',
        'oauth_failed' => "We couldn't sign you in with Google. Please try again in a moment.",
        'google_email_unverified' => 'Google has not verified the email address of that account, so we cannot use it.',
        'google_email_mismatch' => 'That Google account uses a different email address than the one expected here.',
        'recent_auth_required' => 'Please confirm it is you first, then connect Google again.',
        'google_in_use' => 'That Google account is already connected to another account.',
        'email_unavailable' => "This email can't be used with your account. Try another Google account.",
        'account_pending_deletion' => 'This account is scheduled for deletion. Contact us to restore it.',
        'pending_staff_invitation' => 'Open the invitation link we emailed you.',

        // Phone codes (13 §4, §5.2, §5.7). `otp_invalid` counts the tries the code has left (`:attemptsLeft`).
        'phone_invalid' => "That doesn't look like a phone number. Check it and try again.",
        'phone_not_mobile' => 'Enter a mobile number: codes are sent by WhatsApp or SMS.',
        'phone_country_not_supported' => "We can't send codes to numbers from that country yet.",
        'captcha_required' => 'Complete the check below to get a code.',
        'captcha_unavailable' => 'The check that you are not a robot is not available right now. Please try again in a moment.',
        'otp_cooldown' => 'Please wait a moment before asking for another code.',
        'otp_rate_limited' => 'Too many codes were asked for. Please try again later.',
        'otp_unavailable' => "We can't send codes right now. Please try again later or sign in another way.",
        'otp_send_failed' => "We couldn't send the code. Please try again in a moment.",
        'otp_invalid' => "{0} That code isn't right and has no tries left.|{1} That code isn't right. 1 attempt left.|[2,*] That code isn't right. :attemptsLeft attempts left.",
        'otp_expired' => 'That code has expired. Ask for a new one.',
        'otp_too_many_attempts' => 'Too many wrong tries. Ask for a new code.',
        'otp_failed' => "We couldn't sign you in with that number. Please try again.",
        'staff_use_email' => 'Staff sign in with their email address and password.',
        'phone_unavailable' => "That phone number can't be used with your account.",
        'reauth_no_phone' => 'There is no verified phone number on your account to send a code to.',
    ],

];
