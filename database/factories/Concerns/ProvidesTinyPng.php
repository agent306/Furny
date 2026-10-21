<?php

declare(strict_types=1);

namespace Database\Factories\Concerns;

/**
 * A 1 x 1 transparent PNG, enough for any png-only `thumbnail` media collection.
 */
trait ProvidesTinyPng
{
    private static function tinyPng(): string
    {
        return (string) base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', true);
    }
}
