<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Models\User;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** A reference to a user for lists and timelines (10 §3): enough to show a name and an avatar, nothing private. */
#[TypeScript]
final class UserRefData extends Data
{
    public function __construct(
        public string $id,
        public string $name,
        public ?string $avatarUrl,
        public bool $isStaff,
    ) {}

    public static function fromUser(User $user): self
    {
        $url = $user->getFirstMediaUrl('avatar', 'thumb');

        return new self($user->id, $user->name, $url === '' ? null : $url, $user->isStaff());
    }
}
