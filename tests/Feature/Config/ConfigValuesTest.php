<?php

declare(strict_types=1);

use App\Providers\AppServiceProvider;
use App\Support\Media\Media;
use Illuminate\Support\Facades\Log;

it('pins the application basics', function (): void {
    expect(config('app.timezone'))->toBe('UTC')
        ->and(config('app.supported_locales'))->toBe(['en'])
        ->and(config('app.version'))->toBeString()->not->toBeEmpty();
});

it('configures the two queue connections with retry_after above the job timeouts', function (): void {
    expect(config('queue.connections.redis.retry_after'))->toBe(180)
        ->and(config('queue.connections.redis-long.retry_after'))->toBe(720)
        ->and(config('queue.connections.redis-long.queue'))->toBe('imports')
        ->and(config('queue.connections.redis-long.driver'))->toBe('redis')
        ->and(config('queue.connections.redis-long.connection'))->toBe(config('queue.connections.redis.connection'));
});

it('gives sessions their own Redis database', function (): void {
    expect(config('database.redis.sessions.database'))->toEqual(env('REDIS_SESSION_DB', 2))
        ->and(config('database.redis.cache.database'))->toEqual(env('REDIS_CACHE_DB', 1))
        ->and(config('database.redis.default.database'))->toEqual(env('REDIS_DB', 0));
});

it('defaults the Redis databases to 0, 1 and 2 when the environment is empty', function (): void {
    /** @var array{redis: array<string, array{database: string}>} $database */
    $database = evaluateConfigFile('database', ['REDIS_DB' => false, 'REDIS_CACHE_DB' => false, 'REDIS_SESSION_DB' => false]);

    expect(array_map('intval', [
        $database['redis']['default']['database'],
        $database['redis']['cache']['database'],
        $database['redis']['sessions']['database'],
    ]))->toBe([0, 1, 2]);
});

it('configures the private and public object storage disks', function (): void {
    // AWS_* values of .env must not leak in: assert the file's own defaults.
    /** @var array{disks: array<string, array<string, mixed>>} $filesystems */
    $filesystems = evaluateConfigFile('filesystems', array_fill_keys(
        ['AWS_DEFAULT_REGION', 'AWS_USE_PATH_STYLE_ENDPOINT', 'AWS_BUCKET', 'AWS_PUBLIC_BUCKET'],
        false,
    ));

    foreach (['s3' => 'private', 's3-public' => 'public'] as $disk => $visibility) {
        expect($filesystems['disks'][$disk])->toMatchArray([
            'driver' => 's3',
            'visibility' => $visibility,
            'throw' => true,
            'use_path_style_endpoint' => true,
            'region' => 'auto',
        ]);
    }

    expect(config('filesystems.disks.s3.bucket'))->toBe(env('AWS_BUCKET'))
        ->and(config('filesystems.disks.s3-public.bucket'))->toBe(env('AWS_PUBLIC_BUCKET'));
});

it('reads the engine, import and notification configuration', function (): void {
    expect(config('engine.node_binary'))->toBe('node')
        ->and(config('imports.max_bytes.dxf'))->toBe(15 * 1024 * 1024)
        ->and(config('imports.max_pdf_pages'))->toBe(20)
        ->and(config('imports.max_active_per_user'))->toBe(2)
        ->and(config('imports.vision.recognize_timeout_s'))->toBe(600)
        ->and(config('imports.retention.discard_ready_after_days'))->toBe(60)
        ->and(array_keys(config('notification_events.categories')))
        ->toBe(['orders', 'changes', 'quotes', 'production', 'messages', 'imports_ai', 'staff'])
        ->and(config('notification_events.events'))->toBe([]);
});

it('serves no cross-origin API', function (): void {
    expect(config('cors.paths'))->toBe([]);
});

it('keeps closures out of every config file so config:cache works', function (): void {
    $closures = [];
    $walk = function (mixed $value, string $path) use (&$walk, &$closures): void {
        if ($value instanceof Closure) {
            $closures[] = $path;
        } elseif (is_array($value)) {
            foreach ($value as $key => $item) {
                $walk($item, $path.'.'.$key);
            }
        }
    };

    $walk(config()->all(), 'config');

    expect($closures)->toBe([]);
});

it('logs a warning when the application name is too long for SMS', function (): void {
    Log::spy();
    config(['app.name' => str_repeat('x', 21)]);

    (new AppServiceProvider($this->app))->boot();

    Log::shouldHaveReceived('warning')->once();
});

it('stays quiet when the application name fits in 20 characters', function (): void {
    Log::spy();
    config(['app.name' => str_repeat('x', 20)]);

    (new AppServiceProvider($this->app))->boot();

    Log::shouldNotHaveReceived('warning');
});

it('defaults the media library to the private s3 disk, the default queue and the application media model', function (): void {
    /** @var array<string, mixed> $media */
    $media = evaluateConfigFile('media-library', [
        'MEDIA_DISK' => false, 'MEDIA_QUEUE' => false, 'QUEUE_CONVERSIONS_BY_DEFAULT' => false, 'IMAGE_DRIVER' => false,
    ]);

    expect($media['disk_name'])->toBe('s3')
        ->and($media['queue_name'])->toBe('default')
        ->and($media['queue_conversions_by_default'])->toBeTrue()
        ->and($media['media_model'])->toBe(Media::class)
        ->and($media['image_driver'])->toBe('gd');
});

it('takes the Pulse ingest driver from the environment', function (): void {
    /** @var array{ingest: array{driver: string}} $pulse */
    $pulse = evaluateConfigFile('pulse', ['PULSE_INGEST_DRIVER' => 'redis']);

    expect($pulse['ingest']['driver'])->toBe('redis');
});

it('lets the media library accept the largest collection file (40 MB, 02 §10)', function (): void {
    expect(config('media-library.max_file_size'))->toBeGreaterThanOrEqual(40 * 1024 * 1024);
});
