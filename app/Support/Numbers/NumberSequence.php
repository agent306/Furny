<?php

declare(strict_types=1);

namespace App\Support\Numbers;

use Illuminate\Support\Facades\DB;

/**
 * Gapless counters in `number_sequences` (02 §2.2). The row is locked until the surrounding
 * transaction ends, so two concurrent callers never receive the same number.
 */
final class NumberSequence
{
    public static function next(string $key): int
    {
        return DB::transaction(static function () use ($key): int {
            DB::statement(
                'INSERT INTO number_sequences (key, last_value, created_at, updated_at) VALUES (?, 0, now(), now()) ON CONFLICT (key) DO NOTHING',
                [$key],
            );

            $last = (int) DB::table('number_sequences')->where('key', $key)->lockForUpdate()->value('last_value');
            $next = $last + 1;

            DB::table('number_sequences')->where('key', $key)->update(['last_value' => $next, 'updated_at' => now()]);

            return $next;
        });
    }
}
