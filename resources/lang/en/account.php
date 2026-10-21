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

    // 11 §18, 13 §5.10: the staff member's page for their second factor.
    'two_factor' => [
        'title' => 'Two-factor authentication',
        'description' => 'Protect your account with a code from an authenticator app each time you sign in.',
        'enforced' => 'Set up two-factor authentication to use the admin area.',
        'required_note' => 'Two-factor authentication is required for your role.',
        'status' => [
            'title' => 'Status',
            'on' => 'On',
            'off' => 'Off',
            'on_description' => 'You enter a code from your authenticator app each time you sign in.',
            'off_description' => 'Your account is protected by your password alone.',
        ],
        'enable' => 'Enable two-factor authentication',
        'setup' => [
            'title' => 'Set up your authenticator',
            'step_scan' => 'Scan this QR code with an authenticator app, such as Google Authenticator, 1Password or Authy.',
            'qr_alt' => 'QR code for your authenticator app',
            'qr_loading' => 'Loading the QR code…',
            'qr_error' => "We couldn't load the QR code. Try again.",
            'retry' => 'Try again',
            'key_label' => 'Or enter this setup key in your app',
            'copy_key' => 'Copy the setup key',
            'step_code' => 'Then enter the 6-digit code your app shows.',
            'code' => '6-digit code',
            'confirm' => 'Confirm and turn on',
            'cancel' => 'Cancel setup',
        ],
        'codes' => [
            'title' => 'Save your recovery codes',
            'description' => 'If you lose your authenticator, each of these codes signs you in once. Keep them somewhere safe, such as a password manager.',
            'list' => 'Recovery codes',
            'copy' => 'Copy the recovery codes',
            'download' => 'Download',
            'saved' => 'I saved these codes',
            'done' => 'Done',
            'continue' => 'Continue to the dashboard',
            'error' => "We couldn't load the recovery codes. Try again.",
        ],
        'manage' => [
            'regenerate' => 'Regenerate recovery codes',
            'regenerate_description' => 'Get a new set of eight codes. The ones you have stop working.',
            'disable' => 'Disable',
            'disable_description' => 'Sign in with your password alone again.',
        ],
        'confirm' => [
            'regenerate' => [
                'title' => 'Regenerate your recovery codes?',
                'description' => 'The codes you have now stop working. You get eight new ones to save.',
                'action' => 'Regenerate',
            ],
            'cancel' => [
                'title' => 'Cancel the setup?',
                'description' => 'The QR code stops working. You can start again whenever you like.',
                'action' => 'Cancel setup',
            ],
            'disable' => [
                'title' => 'Turn off two-factor authentication?',
                'description' => 'Your account will be protected by your password alone.',
                'action' => 'Turn off',
            ],
        ],
        'toasts' => [
            'enabled' => 'Two-factor authentication is on.',
            'disabled' => 'Two-factor authentication is off.',
            'cancelled' => 'The setup was cancelled.',
            'regenerated' => 'You have new recovery codes.',
        ],
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
