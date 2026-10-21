<?php

declare(strict_types=1);

use Illuminate\Process\Pool;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;

/*
 * Four OS processes (separate connections) draw from one sequence at the same time; the row lock of
 * NumberSequence::next must hand out every number exactly once. The test transaction of
 * LazilyRefreshDatabase is irrelevant: the child processes write committed rows of their own.
 */
it('hands out unique numbers to concurrent processes', function (): void {
    $key = 'test:'.Str::lower((string) Str::ulid());
    DB::select('select 1'); // triggers the lazy migration before the children connect

    $code = sprintf(
        'for ($i = 0; $i < 25; $i++) { echo \App\Support\Numbers\NumberSequence::next(%s), PHP_EOL; }',
        var_export($key, true),
    );
    $env = [
        'APP_ENV' => 'testing',
        'DB_DATABASE' => (string) config('database.connections.pgsql.database'),
    ];

    try {
        $results = Process::pool(function (Pool $pool) use ($code, $env): void {
            foreach (range(1, 4) as $i) {
                $pool->as("worker{$i}")->env($env)->timeout(120)->path(base_path())->command([PHP_BINARY, 'artisan', 'tinker', '--execute', $code]);
            }
        })->start()->wait();

        $numbers = [];

        foreach ($results as $name => $result) {
            expect($result->successful())->toBeTrue("{$name} failed: ".$result->errorOutput().$result->output());
            $numbers = [...$numbers, ...array_map('intval', preg_split('/\s+/', trim($result->output())))];
        }

        expect($numbers)->toHaveCount(100)
            ->and(array_unique($numbers))->toHaveCount(100)
            ->and(max($numbers))->toBe(100)
            ->and(min($numbers))->toBe(1);
    } finally {
        // The children committed outside the test transaction; remove their row on a separate connection.
        DB::connectUsing('cleanup', config('database.connections.pgsql'))
            ->table('number_sequences')->where('key', $key)->delete();
    }
})->group('concurrency');
