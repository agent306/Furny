<?php

declare(strict_types=1);

use App\Http\Controllers\Customer\DashboardController;
use Illuminate\Support\Facades\Route;

// Registered under the `customer.` name prefix by bootstrap/app.php.
Route::get('dashboard', DashboardController::class)->name('dashboard');
