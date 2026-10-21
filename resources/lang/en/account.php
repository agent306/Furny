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
        'avatar_updated' => 'Photo updated.',
        'avatar_removed' => 'Photo removed.',
        'preferences_saved' => 'Preferences saved.',
    ],

    // 10 §13.4: the refusals of the preferences form.
    'errors' => [
        'length_unit' => 'Choose a length unit that fits the measurement system.',
        'timezone' => 'Choose a valid time zone.',
    ],

    // 10 §13.1, 11 §18: the sections of the account area.
    'nav' => [
        'label' => 'Account sections',
        'profile' => 'Profile',
        'security' => 'Security',
        'preferences' => 'Preferences',
        'two_factor' => 'Two-factor',
    ],

    // 10 §13.2: the page of the details.
    'profile' => [
        'title' => 'Profile',
        'description' => 'Your photo and the details we reach you with.',
        'photo' => [
            'title' => 'Photo',
            'description' => 'Shown next to your name.',
            'upload_label' => 'Change photo',
            'upload_hint' => 'JPG, PNG or WebP, up to {max}.',
            'remove' => 'Remove photo',
        ],
        'details' => [
            'title' => 'Your details',
            'description' => 'Your name, and the email address we write to.',
            'name' => 'Full name',
            'email' => 'Email address',
            'email_hint' => "We'll send a verification link to the new address.",
            'marketing_opt_in' => 'Send me occasional updates and offers',
        ],
        'phone' => [
            'title' => 'Phone number',
            'description' => 'We send codes and order updates to this number.',
            'staff_description' => 'Used for WhatsApp notifications and for codes that confirm it is you.',
            'none' => 'No phone number yet.',
            'verified' => 'Verified',
            'not_verified' => 'Not verified',
            'add' => 'Add a phone number',
            'verify' => 'Verify',
            'unavailable' => "Codes can't be sent right now, so a phone number can't be verified. Try again later.",
        ],
        'email_verification' => [
            'title' => 'Email verification',
            'description' => 'Your address is not verified yet, so some actions stay locked.',
            'resend' => 'Resend link',
        ],
    ],

    // 10 §13.3: the page of the sign-in methods and the devices.
    'security' => [
        'title' => 'Security',
        'description' => 'How you sign in, and where you are signed in.',
        'password' => [
            'title' => 'Password',
            'set_title' => 'Set a password',
            'description' => 'Choose a password that you use nowhere else.',
            'set_description' => 'You sign in without a password today. Set one to also sign in with your email.',
            'current' => 'Current password',
            'new' => 'New password',
            'confirmation' => 'Confirm new password',
            'save' => 'Update password',
            'set' => 'Set password',
        ],
        'google' => [
            'title' => 'Google',
            'description' => 'Sign in with your Google account.',
            'connected' => 'Connected',
            'not_connected' => 'Not connected',
            'disconnect' => 'Disconnect',
        ],
        'phone' => [
            'title' => 'Phone sign-in',
            'description' => 'Sign in with a code sent to your phone.',
            'on' => 'On: {phone}',
            'off' => 'Off',
            'manage' => 'Manage your phone number',
        ],
        'devices' => [
            'title' => 'Devices',
            'description' => 'The devices that are signed in to your account.',
            'this_device' => 'This device',
            'method' => '{method, select, password {Password} otp {Phone code} google {Google} remember {Remembered} other {Signed in}}',
            'sign_out' => 'Sign out',
            'sign_out_label' => 'Sign out {device}',
            'sign_out_others' => 'Sign out all other devices',
            'sign_out_others_title' => 'Sign out all other devices?',
            'sign_out_others_body' => 'Every device but this one is signed out. They sign in again with their password or a code.',
        ],
    ],

    // 10 §13.4: the page of the units and the time zone.
    'preferences' => [
        'title' => 'Preferences',
        'description' => 'How lengths and times are shown to you.',
        'units' => [
            'title' => 'Measurement system',
            'description' => 'The system your drawings and sizes are shown in.',
            'metric' => 'Metric',
            'metric_hint' => 'Millimetres, centimetres and metres',
            'imperial' => 'Imperial',
            'imperial_hint' => 'Feet and inches',
        ],
        'length_unit' => [
            'label' => 'Editing length unit',
            'hint' => 'The unit length fields start in.',
            'mm' => 'Millimetres (mm)',
            'cm' => 'Centimetres (cm)',
            'm' => 'Metres (m)',
            'ftin' => 'Feet and inches (ft-in)',
            'in' => 'Inches (in)',
        ],
        'timezone' => [
            'title' => 'Time zone',
            'description' => 'Dates and times are shown in this time zone.',
            'label' => 'Time zone',
            'search' => 'Search time zones',
            'empty' => 'No time zone matches.',
        ],
        'appearance' => [
            'title' => 'Appearance',
            'description' => 'Saved on this device.',
        ],
    ],
];
