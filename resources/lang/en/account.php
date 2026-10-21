<?php

declare(strict_types=1);

return [
    // 13 §5.7: the answer to "send me a code" for a phone number that is being added to an account.
    'otp_sent' => 'We sent a code {channel, select, whatsapp {by WhatsApp} other {by SMS}} to {phone}.',

    // 10 §13.2.3: the dialog that adds or changes the phone number.
    'phone_dialog' => [
        'title' => 'Verify your phone number',
        'description' => "We'll send a 6-digit code by WhatsApp or SMS to confirm the number is yours.",
        'phone' => 'Phone number',
        'send' => 'Send code',
        'sent_via' => 'Sent via {channel, select, whatsapp {WhatsApp} other {SMS}}.',
        'code' => '6-digit code',
        'code_hint' => 'Enter the code we sent to {phone}.',
        'verify' => 'Verify',
        'resend' => 'Send a new code',
        'resend_in' => 'You can ask for a new code in {seconds, plural, one {# second} other {# seconds}}.',
        'change_number' => 'Change number',
    ],

    'toasts' => [
        'session_revoked' => 'That device was signed out.',
        'email_verified' => 'Your email address is verified.',
        'password_updated' => 'Password updated.',
        'google_linked' => 'Google is now connected to your account.',
        'google_unlinked' => 'Google is disconnected from your account.',
        'profile_updated' => 'Your details were saved.',
        'phone_verified' => 'Phone number verified.',
        'sessions_revoked' => '{count, plural, =0 {No other devices were signed in.} one {Signed out # other device.} other {Signed out # other devices.}}',
    ],
];
