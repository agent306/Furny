<?php

declare(strict_types=1);

return [
    'title' => 'Staff',
    'description' => 'Invite people, set their roles and look after their access.',
    'invite' => 'Invite staff member',

    // Refusals (13 §5.9, §7.3); the codes are `staff.email_in_use`, `staff.invitation_pending`, `staff.last_owner`,
    // `staff.errors.self` and `staff.invitation_closed`.
    'errors' => [
        'email_in_use' => 'This email already belongs to an account.',
        'invitation_pending' => 'An invitation is already pending — resend it instead.',
        'last_owner' => 'There must be at least one active owner.',
        'self' => "You can't change your own account here.",
        'invitation_closed' => 'This invitation was already accepted or revoked.',
    ],

    'toasts' => [
        'invited' => 'Invitation sent to {email}.',
        'resent' => 'Invitation sent again to {email}.',
        'revoked' => 'Invitation to {email} revoked.',
        'updated' => '{name} was updated.',
        'deactivated' => '{name} was deactivated and signed out everywhere.',
        'activated' => '{name} can sign in again.',
        'two_factor_reset' => 'Two-factor authentication was reset for {name}.',
    ],

    'members' => [
        'title' => 'Members',
        'columns' => [
            'member' => 'Member',
            'role' => 'Role',
            'two_factor' => 'Two-factor',
            'status' => 'Status',
            'last_login' => 'Last sign-in',
            'actions' => 'Actions',
        ],
        'you' => 'You',
        'never' => 'Never',
        'status' => [
            'active' => 'Active',
            'inactive' => 'Deactivated',
        ],
        'two_factor' => [
            'on' => 'On',
            'off_required' => 'Off — required',
            'off' => 'Off',
        ],
        'menu' => 'Actions for {name}',
        'actions' => [
            'edit' => 'Edit name and role',
            'deactivate' => 'Deactivate',
            'activate' => 'Reactivate',
            'reset_two_factor' => 'Reset two-factor',
        ],
    ],

    'invitations' => [
        'title' => 'Invitations',
        'empty' => 'No invitations are waiting.',
        'columns' => [
            'email' => 'Email',
            'role' => 'Role',
            'invited_by' => 'Invited by',
            'expires' => 'Expires',
            'actions' => 'Actions',
        ],
        'expired' => 'Expired',
        'unknown_inviter' => '—',
        'resend' => 'Resend',
        'resend_aria' => 'Resend the invitation to {email}',
        'revoke' => 'Revoke',
        'revoke_aria' => 'Revoke the invitation to {email}',
    ],

    'invite_dialog' => [
        'title' => 'Invite a staff member',
        'description' => 'They get an email with a link to choose a password. The link works for 72 hours.',
        'name' => 'Name',
        'email' => 'Email',
        'role' => 'Role',
        'submit' => 'Send invitation',
    ],

    'edit_dialog' => [
        'title' => 'Edit {name}',
        'description' => 'Each member has one role. A new role applies at once.',
        'name' => 'Name',
        'role' => 'Role',
        'submit' => 'Save',
    ],

    'confirm' => [
        'deactivate' => [
            'title' => 'Deactivate {name}?',
            'description' => "They'll be signed out everywhere and can't sign in until you reactivate them.",
            'action' => 'Deactivate',
        ],
        'reset_two_factor' => [
            'title' => 'Reset two-factor for {name}?',
            'description' => "They'll have to set up two-factor authentication again.",
            'action' => 'Reset two-factor',
        ],
        'revoke' => [
            'title' => 'Revoke the invitation to {email}?',
            'description' => 'The link in the email stops working.',
            'action' => 'Revoke invitation',
        ],
    ],

    // The page behind the link of the invitation mail (11 §7.1).
    'accept' => [
        'title' => 'Join {appName}',
        'description' => "You've been invited as {role}. Choose a password to create your account.",
        'email' => 'Email',
        'name' => 'Your name',
        'password' => 'Password',
        'password_confirmation' => 'Confirm password',
        'submit' => 'Create my account',
        'google_connected' => 'Your Google account is connected. You still choose a password.',
        'expires' => 'This invitation expires on {date}.',
        // The caption under the button, one message: the tags mark the two links (the Google button's caption is built the same way).
        'terms' => 'By creating your account you accept the <terms>Terms of service</terms> and the <privacy>Privacy policy</privacy>.',
    ],

    'invalid' => [
        'title' => [
            'invalid' => 'This link is not valid',
            'expired' => 'This link has expired',
            'accepted' => 'This invitation was already used',
            'revoked' => 'This invitation was withdrawn',
            'signed_in' => 'Sign out to accept the invitation',
        ],
        'body' => [
            'invalid' => 'This link has expired or is invalid — ask for a new invitation.',
            'expired' => 'This link has expired or is invalid — ask for a new invitation.',
            'accepted' => 'An account was already created from this invitation. You can sign in with it.',
            'revoked' => 'The invitation was withdrawn. Ask for a new one if you still need access.',
            'signed_in' => "You're signed in as someone else. Sign out first, then open the link in the email again.",
        ],
        'sign_out' => 'Sign out',
        'log_in' => 'Go to sign in',
    ],
];
