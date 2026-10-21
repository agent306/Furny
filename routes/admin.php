<?php

declare(strict_types=1);

use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\StaffController;
use App\Http\Controllers\Admin\StaffInvitationController;
use Illuminate\Support\Facades\Route;

// Registered by bootstrap/app.php under the `/admin` prefix and the `admin.` name prefix with the middleware `web`,
// `auth`, `active`, `staff`, `2fa.enrolled` and `session.absolute` (13 §1).
Route::get('/', DashboardController::class)->name('dashboard');

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
