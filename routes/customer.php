<?php

declare(strict_types=1);

use App\Http\Controllers\Customer\Account\AvatarController;
use App\Http\Controllers\Customer\Account\DataExportController;
use App\Http\Controllers\Customer\Account\DeletionController;
use App\Http\Controllers\Customer\Account\PreferencesController;
use App\Http\Controllers\Customer\Account\ProfileController;
use App\Http\Controllers\Customer\Account\SecurityController;
use App\Http\Controllers\Customer\DashboardController;
use Illuminate\Support\Facades\Route;

// Registered by bootstrap/app.php under the `customer.` name prefix with the middleware `web`, `auth`, `active`,
// `customer` and `onboarded` (13 §1).
Route::get('dashboard', DashboardController::class)->name('dashboard');

// The account pages of the customer (10 §13). Open to a customer who has not finished onboarding (EnsureCustomerOnboarded::EXEMPT).
// The forms behind them post to the routes of Fortify (details, password) and the `account.*` ones (phone, Google, devices).
Route::prefix('account')->name('account.')->group(function (): void {
    Route::get('profile', [ProfileController::class, 'show'])->name('profile');
    Route::put('avatar', [AvatarController::class, 'update'])->name('avatar.update');
    Route::get('security', [SecurityController::class, 'show'])->name('security');
    Route::get('preferences', [PreferencesController::class, 'show'])->name('preferences');
    Route::put('preferences', [PreferencesController::class, 'update'])->name('preferences.update');
});

// Deleting the account and downloading one's data (13 §9, 10 §13.7): sensitive, so behind a recent authentication
// (13 §6.4). The download also needs a verified email or phone, and is limited to 3 a day.
Route::middleware('recent.auth')->prefix('account')->name('account.')->group(function (): void {
    Route::get('/', [DeletionController::class, 'show'])->name('delete');
    Route::delete('/', [DeletionController::class, 'destroy'])->name('destroy');
    Route::get('export', DataExportController::class)->middleware(['verified.contact', 'throttle:data-export'])->name('export');
});
