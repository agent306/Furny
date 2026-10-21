<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** An Active order that blocks a deletion (10 §13.7): the id and the number the customer knows it by. */
#[TypeScript]
final class ActiveOrderRefData extends Data
{
    public function __construct(
        public string $id,
        public string $number,
    ) {}
}
