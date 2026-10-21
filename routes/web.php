<?php

declare(strict_types=1);

use App\Http\Controllers\LegalController;
use App\Http\Controllers\ManifestController;
use App\Http\Controllers\WelcomeController;
use Illuminate\Support\Facades\Route;

// Public pages (14 §2). The customer and admin route files are registered in bootstrap/app.php.
Route::get('/', WelcomeController::class)->name('welcome');
Route::get('terms', [LegalController::class, 'terms'])->name('legal.terms');
Route::get('privacy', [LegalController::class, 'privacy'])->name('legal.privacy');
Route::get('manifest.webmanifest', ManifestController::class)->name('manifest');
