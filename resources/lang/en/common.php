<?php

declare(strict_types=1);

return [
    'photo_n' => 'Photo {n}',

    'counts' => [
        'items' => '{count, plural, one {# item} other {# items}}',
    ],

    'actions' => [
        'back' => 'Back',
        'cancel' => 'Cancel',
        'close' => 'Close',
        'confirm' => 'Confirm',
        'copy' => 'Copy',
        'discard' => 'Discard',
        'log_out' => 'Log out',
        'retry' => 'Retry',
        'save_changes' => 'Save changes',
    ],

    'address' => [
        'city' => 'City',
        'country' => 'Country',
        'label' => 'Label',
        'label_placeholder' => 'Home',
        'line1' => 'Address line 1',
        'line2' => 'Address line 2',
        'postal_code' => 'Postal code',
        'region' => 'State / region',
    ],

    'pagination' => [
        'first' => 'First',
        'last' => 'Last',
        'next' => 'Next',
        'previous' => 'Previous',
    ],

    'confirm' => [
        'type_to_confirm' => 'Type {text} to confirm.',
    ],

    'copied' => 'Copied',

    'footer' => [
        'copyright' => '© {year} {business}',
        'privacy' => 'Privacy',
        'terms' => 'Terms',
    ],

    'loading' => 'Loading',

    'nav' => [
        'dashboard' => 'Dashboard',
        'home' => 'Home',
        'staff' => 'Staff',
        'groups' => [
            'administration' => 'Administration',
        ],
    ],

    'offline' => [
        'banner' => "You're offline. Changes will be sent when you reconnect.",
    ],

    'read_only' => 'View only',

    'save_status' => [
        'conflict' => 'Conflict',
        'dirty' => 'Unsaved changes',
        'error' => "Couldn't save",
        'invalid' => 'Fix {count, plural, one {# problem} other {# problems}} to save',
        'offline' => 'Offline — changes kept on this device',
        'saved' => 'Saved',
        'saved_ago' => 'Saved · {time}',
        'saving' => 'Saving…',
    ],

    'screen_too_small' => [
        'title' => 'This screen needs a larger display',
        'body' => 'Open it on a tablet or computer to continue.',
    ],

    'theme' => [
        'dark' => 'Dark',
        'label' => 'Theme',
        'light' => 'Light',
        'system' => 'System',
    ],

    'unsaved_changes' => 'Unsaved changes',

    'validation' => [
        'note_required' => 'Please add a short explanation.',
        'reason_required' => 'Choose a reason.',
    ],

    // 10 §1.1, 15 §9.31: shown to a customer with neither a verified email nor a verified phone.
    'verify_banner' => [
        'message' => 'Verify your email or phone to send orders and messages.',
        'resend_email' => 'Resend email link',
        'email_sent' => 'We sent a new verification link to your email.',
        'verify_phone' => 'Verify phone',
    ],

    'verify_required' => 'Verify your email or phone number to continue.',

    'a11y' => [
        'skip_to_content' => 'Skip to content',
    ],
];
