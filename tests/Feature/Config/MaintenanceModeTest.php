<?php

declare(strict_types=1);

use Illuminate\Contracts\Foundation\MaintenanceMode;
use Illuminate\Support\Facades\Route;

/**
 * 17 §5.11 item 2: `php artisan down` must not break health checks. A fake driver is
 * bound instead of writing storage/framework/down, which would 503 parallel test workers.
 */
beforeEach(function (): void {
    $this->app->instance(MaintenanceMode::class, new class implements MaintenanceMode
    {
        public function activate(array $payload): void {}

        public function deactivate(): void {}

        public function active(): bool
        {
            return true;
        }

        public function data(): array
        {
            return ['except' => [], 'redirect' => null, 'retry' => null, 'refresh' => null, 'secret' => null, 'status' => 503, 'template' => null];
        }
    });
});

it('keeps the shallow health check available during maintenance', function (): void {
    $this->get('/up')->assertOk();
});

it('keeps the deep health check path available during maintenance', function (): void {
    Route::get('up/deep', fn () => response('ok'));

    $this->get('/up/deep')->assertOk();
});

it('answers 503 for application pages during maintenance', function (): void {
    $this->get('/')->assertStatus(503);
});
