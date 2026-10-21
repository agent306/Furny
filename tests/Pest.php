<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test case and database strategy per suite (16 §3, §4.1)
|--------------------------------------------------------------------------
*/

pest()->extend(TestCase::class)->use(LazilyRefreshDatabase::class)->in('Feature');
pest()->extend(TestCase::class)->use(RefreshDatabase::class)->in('Browser');
pest()->extend(TestCase::class)->in('Unit');

pest()->browser()->timeout(15_000);

/**
 * Evaluates a config file in a clean child process with the given environment variables
 * removed (value false) or overridden, so that phpunit.xml and .env values cannot leak
 * into assertions about the file's own defaults (16 §2).
 *
 * @param  array<string, string|false>  $env
 */
function evaluateConfigFile(string $file, array $env = []): mixed
{
    $process = new Process(
        [
            PHP_BINARY,
            '-r',
            'require "vendor/autoload.php"; new Illuminate\Foundation\Application(getcwd()); echo json_encode(require $argv[1]);',
            '--',
            base_path("config/{$file}.php"),
        ],
        base_path(),
        $env,
    );
    $process->mustRun();

    return json_decode($process->getOutput(), true, flags: JSON_THROW_ON_ERROR);
}
