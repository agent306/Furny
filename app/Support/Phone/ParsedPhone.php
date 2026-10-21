<?php

declare(strict_types=1);

namespace App\Support\Phone;

/** A phone number that passed `PhoneNumberParser`: E.164 and the ISO 3166-1 alpha-2 region it belongs to. */
final readonly class ParsedPhone
{
    public function __construct(
        public string $e164,
        public string $region,
    ) {}
}
