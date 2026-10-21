<?php

declare(strict_types=1);

use Illuminate\Support\Facades\File;
use Symfony\Component\Process\Process;

/**
 * Boot purity (17 §5.11 item 3): the image build runs `php artisan optimize` without
 * Postgres or Redis, and nothing in config or service providers may touch them.
 */
beforeEach(function (): void {
    // Inside the project, and handed to artisan relative to it: Laravel only treats a path starting with
    // a slash as absolute, so a Windows drive path (C:\...) would be resolved against the base path.
    $this->cacheDir = storage_path('framework/testing/furny-boot-'.bin2hex(random_bytes(4)));
    File::makeDirectory($this->cacheDir);
});

afterEach(function (): void {
    File::deleteDirectory($this->cacheDir);
});

/** @return array<string, string> */
function bootWithoutServicesEnv(string $cacheDir): array
{
    $relative = 'storage/framework/testing/'.basename($cacheDir);

    return [
        'DB_HOST' => 'invalid.invalid',
        'REDIS_HOST' => 'invalid.invalid',
        'APP_CONFIG_CACHE' => $relative.'/config.php',
        'APP_ROUTES_CACHE' => $relative.'/routes.php',
        'APP_EVENTS_CACHE' => $relative.'/events.php',
    ];
}

it('runs artisan optimize without a database or Redis', function (): void {
    $process = new Process([PHP_BINARY, 'artisan', 'optimize', '--no-ansi'], base_path(), bootWithoutServicesEnv($this->cacheDir));
    $process->setTimeout(120)->run();

    expect($process->getExitCode())->toBe(0, $process->getOutput().$process->getErrorOutput())
        ->and($this->cacheDir.'/config.php')->toBeFile();
});

it('lists the routes from the cached configuration without a database or Redis', function (): void {
    $env = bootWithoutServicesEnv($this->cacheDir);

    $optimize = new Process([PHP_BINARY, 'artisan', 'optimize', '--no-ansi'], base_path(), $env);
    $optimize->setTimeout(120)->run();

    $routes = new Process([PHP_BINARY, 'artisan', 'route:list', '--json'], base_path(), $env);
    $routes->setTimeout(60)->run();

    expect($optimize->getExitCode())->toBe(0, $optimize->getOutput().$optimize->getErrorOutput())
        ->and($routes->getExitCode())->toBe(0, $routes->getErrorOutput())
        ->and(json_decode($routes->getOutput(), true, flags: JSON_THROW_ON_ERROR))->toBeArray()->not->toBeEmpty();
});
