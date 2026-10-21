<?php

declare(strict_types=1);

namespace App\Domain\Shared\Data;

use Spatie\LaravelData\Data;

/** The model an upload is authorised against: its morph alias and id (13 §11.2). */
final class PresignTargetData extends Data
{
    public function __construct(
        public string $type,
        public string $id,
    ) {}
}
