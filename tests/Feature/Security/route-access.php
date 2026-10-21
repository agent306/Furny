<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Route access map (13 §20.1)
|--------------------------------------------------------------------------
|
| Every named route of the app maps to who may use it. `RouteCoverageTest` fails for a route that is missing
| here, and for an entry whose route is gone, so every task that adds a route adds its entry.
|
|   audience    guest     only for signed-out visitors (signed-in users are redirected away)
|               customer  customers only (staff are sent to the admin dashboard, guests to login)
|               staff     staff only (customers get 403, guests go to login)
|               any       any signed-in user
|               public    everybody
|               webhook   stateless, authenticated by its signature (13 §14)
|   permission  a `PermissionName` value the route requires of staff, or null
|   gate        an `OwnerGate` value the route requires of staff, or null
|
| Vendor dashboards (horizon, pulse, telescope), the framework's health check, Livewire and the dev tools are
| gated elsewhere and are not listed (tests/Support/Routing/RouteInventory.php).
*/

$entry = static fn (string $audience, ?string $permission = null, ?string $gate = null): array => [
    'audience' => $audience,
    'permission' => $permission,
    'gate' => $gate,
];

return [
    // Public pages and machine endpoints (14 §2).
    'welcome' => $entry('public'),
    'legal.terms' => $entry('public'),
    'legal.privacy' => $entry('public'),
    'manifest' => $entry('public'),
    'csp.report' => $entry('public'),
    'fallback' => $entry('public'),
    'unmatched.plain' => $entry('public'),

    // Fortify, signed-out (13 §2).
    'login' => $entry('guest'),
    'login.store' => $entry('guest'),
    'register' => $entry('guest'),
    'register.store' => $entry('guest'),
    'password.request' => $entry('guest'),
    'password.email' => $entry('guest'),
    'password.reset' => $entry('guest'),
    'password.update' => $entry('guest'),
    'two-factor.login' => $entry('guest'),
    'two-factor.login.store' => $entry('guest'),

    // Google sign-in (13 §5.3): open to everybody, the intent decides what the round trip does.
    'auth.google.redirect' => $entry('public'),
    'auth.google.callback' => $entry('public'),

    // The staff invitation link (13 §5.9): public, and good only with its signature; the form posts to the same URL.
    'staff.invitations.show' => $entry('public'),
    'staff.invitations.accept' => $entry('public'),

    // Phone sign-in and sign-up (13 §5.2): for guests; the status poll reads the session's challenge, whoever holds it.
    'auth.otp.create' => $entry('guest'),
    'auth.otp.send' => $entry('guest'),
    'auth.otp.verify.show' => $entry('guest'),
    'auth.otp.verify' => $entry('guest'),
    'auth.otp.resend' => $entry('guest'),
    'auth.otp.status' => $entry('public'),
    'auth.otp.complete.show' => $entry('guest'),
    'auth.otp.complete' => $entry('guest'),

    // Fortify, signed-in (13 §2). Customers get 403 on `two-factor.*` from `PreventCustomerTwoFactor` (13 §5.10), whatever the map says.
    'logout' => $entry('any'),
    'verification.notice' => $entry('any'),
    'verification.verify' => $entry('any'),
    'verification.send' => $entry('any'),
    'user-profile-information.update' => $entry('any'),
    'user-password.update' => $entry('any'),
    'password.confirm' => $entry('any'),
    'password.confirm.store' => $entry('any'),
    'password.confirmation' => $entry('any'),
    'two-factor.enable' => $entry('any'),
    'two-factor.confirm' => $entry('any'),
    'two-factor.disable' => $entry('any'),
    'two-factor.qr-code' => $entry('any'),
    'two-factor.secret-key' => $entry('any'),
    'two-factor.recovery-codes' => $entry('any'),
    'two-factor.regenerate-recovery-codes' => $entry('any'),

    // Account security, both audiences (14 §3.3).
    'account.sessions.destroy' => $entry('any'),
    'account.sessions.destroy-others' => $entry('any'),
    'account.google.unlink' => $entry('any'),
    'account.phone.send' => $entry('any'),
    'account.phone.verify' => $entry('any'),
    'auth.reauthenticate' => $entry('any'),
    'auth.reauthenticate.store' => $entry('any'),

    // Customer app (10 §2).
    'customer.dashboard' => $entry('customer'),

    // Admin app (11 §2).
    'admin.dashboard' => $entry('staff'),

    // The page of the staff member's second factor (13 §5.10): any staff, and exempt from `2fa.enrolled`.
    'admin.security.two-factor' => $entry('staff'),

    // Staff management (11 §7, 13 §5.9). Everything that concerns an owner also needs the owner gate, in the requests and
    // the actions; the route needs `staff.manage`.
    'admin.staff.index' => $entry('staff', 'staff.manage'),
    'admin.staff.invitations.store' => $entry('staff', 'staff.manage'),
    'admin.staff.invitations.resend' => $entry('staff', 'staff.manage'),
    'admin.staff.invitations.revoke' => $entry('staff', 'staff.manage'),
    'admin.staff.update' => $entry('staff', 'staff.manage'),
    'admin.staff.deactivate' => $entry('staff', 'staff.manage'),
    'admin.staff.activate' => $entry('staff', 'staff.manage'),
    'admin.staff.two-factor.reset' => $entry('staff', 'staff.manage'),

    // Browser uploads (13 §11): any signed-in user; what an upload may be used for is decided by its purpose (13 §11.1),
    // and an intent is the presigning user's alone.
    'api.uploads.presign' => $entry('any'),
    'api.uploads.confirm' => $entry('any'),
    'api.uploads.show' => $entry('any'),
];
