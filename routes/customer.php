<?php

declare(strict_types=1);

use App\Http\Controllers\Customer\DashboardController;
use Illuminate\Support\Facades\Route;

// Registered by bootstrap/app.php under the `customer.` name prefix with the middleware `web`, `auth`, `active`,
// `customer` and `onboarded` (13 §1).
Route::get('dashboard', DashboardController::class)->name('dashboard');
