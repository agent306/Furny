<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/** @return array<string, int> */
function tableCounts(): array
{
    $counts = [];
    foreach (DB::select('select tablename from pg_tables where schemaname = current_schema() order by tablename') as $table) {
        $name = $table->tablename;
        if (in_array($name, ['migrations', 'cache', 'cache_locks', 'sessions', 'jobs', 'job_batches', 'failed_jobs'], true)) {
            continue;
        }
        $counts[$name] = DB::table($name)->count();
    }

    return $counts;
}

it('can run twice without changing any table count', function (): void {
    config(['seed.owner' => ['name' => 'Owner', 'email' => 'owner@furny.test', 'password' => 'a-long-owner-password']]);

    expect(Artisan::call('db:seed', ['--force' => true]))->toBe(0);
    $first = tableCounts();

    expect(Artisan::call('db:seed', ['--force' => true]))->toBe(0);

    expect(tableCounts())->toBe($first)
        ->and($first['users'])->toBe(1)
        ->and($first['roles'])->toBe(5)
        ->and($first['permissions'])->toBe(24)
        ->and($first['tax_rates'])->toBe(4)
        ->and($first['materials'])->toBeGreaterThan(0);
});
