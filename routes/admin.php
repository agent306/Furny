<?php

declare(strict_types=1);

use App\Http\Controllers\Admin\DashboardController;
use Illuminate\Support\Facades\Route;

// Registered by bootstrap/app.php under the `/admin` prefix and the `admin.` name prefix with the middleware `web`,
// `auth`, `active`, `staff`, `2fa.enrolled` and `session.absolute` (13 §1).
Route::get('/', DashboardController::class)->name('dashboard');
