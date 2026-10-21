<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
