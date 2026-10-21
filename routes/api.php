<?php

declare(strict_types=1);

use App\Http\Controllers\Api\UploadController;
use Illuminate\Support\Facades\Route;

// The editor's JSON endpoints (14 §4). Registered by bootstrap/app.php under the `/api` prefix and the `api.`
// name prefix, with the middleware `web`, `auth`, `active` and `throttle:api`: session authentication, CSRF
// protection, and bare JSON errors (the `api/*` paths are machine paths, 13 §12). Empty until the editor tasks.

// Browser uploads (13 §11, 14 §4): presigned PUT, confirm, poll. Every upload in the system goes through these.
Route::prefix('uploads')->name('uploads.')->group(function (): void {
    Route::post('presign', [UploadController::class, 'presign'])->middleware('throttle:uploads-presign')->name('presign');
    Route::post('{upload}/confirm', [UploadController::class, 'confirm'])->middleware('throttle:uploads-confirm')->name('confirm');
    Route::get('{upload}', [UploadController::class, 'show'])->name('show');
});
