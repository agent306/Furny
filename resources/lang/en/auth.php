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

];
