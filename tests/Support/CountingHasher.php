<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Hashing\HashManager;
use Illuminate\Support\Facades\Hash;

/** The application's hasher that counts how often it is asked to make or check a hash (the work behind a login). */
final class CountingHasher extends HashManager
{
    public int $checks = 0;

    public int $makes = 0;

    /** Replaces the hasher of the application and returns the counter. */
    public static function install(): self
    {
        $hasher = new self(app());
        Hash::swap($hasher);

        return $hasher;
    }

    /** @param  array<string, mixed>  $options */
    public function check($value, $hashedValue, array $options = []): bool
    {
        $this->checks++;

        return parent::check($value, $hashedValue, $options);
    }

    /** @param  array<string, mixed>  $options */
    public function make($value, array $options = []): string
    {
        $this->makes++;

        return parent::make($value, $options);
    }
}
