<?php

declare(strict_types=1);

return [
    'title' => 'Notifications',
    'empty' => "You're all caught up.",

    'bell' => [
        'aria' => '{count, plural, =0 {Notifications} other {Notifications, # unread}}',
    ],

    // 12 §3.7
    'account' => [
        'welcome' => [
            'customer' => [
                'title' => 'Welcome to {appName}',
                'body' => 'Start by uploading your floor plan or drawing it yourself.',
            ],
        ],
        'deletion_scheduled' => [
            'customer' => [
                'title' => 'Your account will be deleted',
                'body' => "We received a request to delete your account. It will be permanently anonymised on {date}. If this wasn't you, contact us at {businessEmail} immediately.",
            ],
        ],
    ],

    // 12 §3.3, P1-D5: the transactional mails of the sign-in flows. `minutes` is how long the link works.
    'auth' => [
        // 12 §3.7: the last line is the WebOTP origin-bound format (`@host #code`, 13 §4.4).
        'otp' => [
            'sms' => "{code} is your {appName} verification code. It expires in 10 minutes. Do not share it.\n\n@{domain} #{code}",
        ],
        'password_reset' => [
            'subject' => 'Reset your {appName} password',
            'title' => 'Reset your password',
            'body' => 'We got a request to reset the password of your {appName} account. The link works for {minutes, plural, one {# minute} other {# minutes}}. If it was not you, you can ignore this email: your password stays as it is.',
            'action' => 'Choose a new password',
        ],
        'email_verification' => [
            'subject' => 'Verify your email for {appName}',
            'title' => 'Verify your email address',
            'body' => 'Confirm that this address is yours to finish setting up your {appName} account. The link works for {minutes, plural, one {# minute} other {# minutes}}.',
            'action' => 'Verify email',
        ],
    ],

    // 12 §3.3, §3.7: the mail that invites someone to join the staff. `date` is when the invitation expires.
    'staff' => [
        'invited' => [
            'staff' => [
                'title' => "You're invited to {appName}",
                'body' => '{inviterName} invited you to join as {role}. The link expires on {date}.',
                'action' => 'Accept invitation',
            ],
        ],
    ],

    'cta' => [
        'open_dashboard' => 'Open my dashboard',
    ],
];
