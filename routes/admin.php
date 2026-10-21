<?php

declare(strict_types=1);

use App\Http\Controllers\Admin\Account\AvatarController;
use App\Http\Controllers\Admin\Account\PreferencesController;
use App\Http\Controllers\Admin\Account\ProfileController;
use App\Http\Controllers\Admin\Account\SecurityController;
use App\Http\Controllers\Admin\Account\TwoFactorController;
use App\Http\Controllers\Admin\CustomerController;
use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\StaffController;
use App\Http\Controllers\Admin\StaffInvitationController;
use Illuminate\Support\Facades\Route;

// Registered by bootstrap/app.php under the `/admin` prefix and the `admin.` name prefix with the middleware `web`,
// `auth`, `active`, `staff`, `2fa.enrolled` and `session.absolute` (13 §1).
Route::get('/', DashboardController::class)->name('dashboard');

// The second factor of the signed-in staff member (13 §5.10). Exempt from `2fa.enrolled` (EnsureTwoFactorEnrolled::EXEMPT),
// or an owner or admin who has not enrolled could not reach the page that enrols them.
Route::get('account/two-factor', [TwoFactorController::class, 'show'])->name('security.two-factor');

// The staff member's own account pages (11 §18), open to any staff. The second factor has its page above.
Route::prefix('account')->name('account.')->group(function (): void {
    Route::get('profile', [ProfileController::class, 'show'])->name('profile');
    Route::put('avatar', [AvatarController::class, 'update'])->name('avatar.update');
    Route::get('security', [SecurityController::class, 'show'])->name('security');
    Route::get('preferences', [PreferencesController::class, 'show'])->name('preferences');
    Route::put('preferences', [PreferencesController::class, 'update'])->name('preferences.update');
});

// Staff management (11 §7, 13 §5.9): `staff.manage`; everything that concerns an owner also needs the owner gate, which
// the requests and the actions ask. Invitations are limited together, invitations and resends (13 §10).
Route::middleware('can:staff.manage')->prefix('staff')->name('staff.')->group(function (): void {
    Route::get('/', [StaffController::class, 'index'])->name('index');

    Route::post('invitations', [StaffInvitationController::class, 'store'])->middleware('throttle:invitations')->name('invitations.store');
    Route::post('invitations/{invitation}/resend', [StaffInvitationController::class, 'resend'])->middleware('throttle:invitations')->name('invitations.resend');
    Route::delete('invitations/{invitation}', [StaffInvitationController::class, 'revoke'])->name('invitations.revoke');

    Route::put('{user}', [StaffController::class, 'update'])->name('update');
    Route::post('{user}/deactivate', [StaffController::class, 'deactivate'])->name('deactivate');
    Route::post('{user}/activate', [StaffController::class, 'activate'])->name('activate');
    Route::delete('{user}/two-factor', [StaffController::class, 'resetTwoFactor'])->name('two-factor.reset');
});

// The lifecycle of a customer account (13 §9, 14 §9): restore within the 30 days (`customers.manage`), anonymise at once (the
// owner gate `data.delete`). `{user}` includes deleted accounts. The rest of the customer routes arrive with the customer pages (P5).
Route::post('customers/{user}/restore', [CustomerController::class, 'restore'])->middleware('can:customers.manage')->withTrashed()->name('customers.restore');
Route::post('customers/{user}/anonymise', [CustomerController::class, 'anonymise'])->middleware('can:data.delete')->withTrashed()->name('customers.anonymise');
