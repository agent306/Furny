<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Spatie\LaravelPdf\Facades\Pdf;

/**
 * Base test case (16 §2): PostgreSQL only, no network, faked object storage
 * and PDF rendering. The WhatsApp/SMS fakes and the settings-cache reset are
 * added by the tasks that introduce those services.
 */
abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            throw new RuntimeException('Tests run on PostgreSQL only (16 §4.1); SQLite is never used.');
        }

        Storage::fake('s3');
        Storage::fake('s3-public');
        Http::preventStrayRequests();
        Pdf::fake();
    }
}
