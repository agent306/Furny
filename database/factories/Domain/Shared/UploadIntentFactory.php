<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Shared;

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * Default: a pending 15-minute avatar upload with no target (02 §1.6, 13 §11).
 *
 * @extends Factory<UploadIntent>
 */
final class UploadIntentFactory extends Factory
{
    protected $model = UploadIntent::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $purpose = UploadPurpose::Avatar;

        return [
            'user_id' => User::factory(),
            'purpose' => $purpose,
            'target_type' => null,
            'target_id' => null,
            'object_key' => sprintf('tmp/%s/%s/%s', $purpose->value, now()->format('Y/m'), Str::ulid()),
            'processed_key' => null,
            'original_filename' => 'photo.png',
            'declared_mime' => 'image/png',
            'declared_size' => 123_456,
            'sniffed_mime' => null,
            'width' => null,
            'height' => null,
            'status' => UploadStatus::Pending,
            'reason_code' => null,
            'expires_at' => now()->addMinutes(15),
            'consumed_at' => null,
        ];
    }

    public function pending(): static
    {
        return $this->state(fn (): array => [
            'status' => UploadStatus::Pending,
            'expires_at' => now()->addMinutes(15),
        ]);
    }

    public function uploaded(): static
    {
        return $this->state(fn (): array => [
            'status' => UploadStatus::Uploaded,
            'sniffed_mime' => 'image/png',
        ]);
    }

    public function ready(): static
    {
        return $this->state(fn (array $attributes): array => [
            'status' => UploadStatus::Ready,
            'sniffed_mime' => 'image/png',
            'width' => 800,
            'height' => 600,
            'processed_key' => sprintf('uploads/%s/%s/%s.png', $this->purposeValue($attributes), now()->format('Y/m'), Str::ulid()),
        ]);
    }

    public function rejected(string $reason = 'upload_type_not_allowed'): static
    {
        return $this->state(fn (): array => [
            'status' => UploadStatus::Rejected,
            'reason_code' => $reason,
        ]);
    }

    public function consumed(): static
    {
        return $this->ready()->state(fn (): array => [
            'status' => UploadStatus::Consumed,
            'consumed_at' => now(),
        ]);
    }

    public function expired(): static
    {
        return $this->state(fn (): array => [
            'status' => UploadStatus::Expired,
            'expires_at' => now()->subMinute(),
        ]);
    }

    public function purpose(UploadPurpose $purpose): static
    {
        return $this->state(fn (): array => [
            'purpose' => $purpose,
            'object_key' => sprintf('tmp/%s/%s/%s', $purpose->value, now()->format('Y/m'), Str::ulid()),
        ]);
    }

    /** Authorises the upload against a model, stored under its morph alias. */
    public function forTarget(Model $target): static
    {
        return $this->state(fn (): array => [
            'target_type' => $target->getMorphClass(),
            'target_id' => $target->getKey(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function purposeValue(array $attributes): string
    {
        $purpose = $attributes['purpose'] ?? UploadPurpose::Avatar;

        return $purpose instanceof UploadPurpose ? $purpose->value : (string) $purpose;
    }
}
