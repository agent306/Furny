<?php

declare(strict_types=1);

use App\Http\Controllers\Admin\DashboardController;
use Illuminate\Support\Facades\Route;

// Registered under the `/admin` prefix and the `admin.` name prefix by bootstrap/app.php.
Route::get('/', DashboardController::class)->name('dashboard');
