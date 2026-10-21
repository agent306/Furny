<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use Carbon\CarbonImmutable;

it('has exactly the 14 upload purposes of 13 §11.1', function (): void {
    expect(UploadPurpose::cases())->toHaveCount(14)
        ->and(array_map(static fn (UploadPurpose $p): string => $p->value, UploadPurpose::cases()))->toBe([
            'blueprint_source', 'message_attachment', 'production_photo', 'issue_photo', 'delivery_photo',
            'avatar', 'business_logo', 'material_texture', 'finish_texture', 'hardware_image',
            'plan_thumbnail', 'project_cover', 'furniture_thumbnail', 'preset_thumbnail',
        ]);
});

it('has the six upload statuses', function (): void {
    expect(array_map(static fn (UploadStatus $s): string => $s->value, UploadStatus::cases()))
        ->toBe(['pending', 'uploaded', 'ready', 'rejected', 'consumed', 'expired']);
});

it('creates a pending intent by default with enum and immutable date casts', function (): void {
    $intent = UploadIntent::factory()->create()->refresh();

    expect($intent->id)->toHaveLength(26)
        ->and($intent->status)->toBe(UploadStatus::Pending)
        ->and($intent->purpose)->toBeInstanceOf(UploadPurpose::class)
        ->and($intent->user)->toBeInstanceOf(User::class)
        ->and($intent->expires_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($intent->expires_at->isFuture())->toBeTrue()
        ->and($intent->consumed_at)->toBeNull()
        ->and($intent->object_key)->toStartWith('tmp/'.$intent->purpose->value.'/');
});

it('builds every lifecycle state', function (): void {
    $uploaded = UploadIntent::factory()->uploaded()->create();
    $ready = UploadIntent::factory()->ready()->create();
    $rejected = UploadIntent::factory()->rejected('dwg_not_supported')->create();
    $consumed = UploadIntent::factory()->consumed()->create();
    $expired = UploadIntent::factory()->expired()->create();

    expect(UploadIntent::factory()->pending()->make()->status)->toBe(UploadStatus::Pending)
        ->and($uploaded->status)->toBe(UploadStatus::Uploaded)
        ->and($uploaded->sniffed_mime)->not->toBeNull()
        ->and($ready->status)->toBe(UploadStatus::Ready)
        ->and($ready->processed_key)->toStartWith('uploads/')
        ->and($ready->width)->not->toBeNull()
        ->and($rejected->status)->toBe(UploadStatus::Rejected)
        ->and($rejected->reason_code)->toBe('dwg_not_supported')
        ->and($consumed->status)->toBe(UploadStatus::Consumed)
        ->and($consumed->consumed_at)->not->toBeNull()
        ->and($expired->status)->toBe(UploadStatus::Expired)
        ->and($expired->expires_at->isPast())->toBeTrue();
});

it('resolves its target through the morph alias', function (): void {
    $user = User::factory()->create();
    $intent = UploadIntent::factory()->forTarget($user)->create()->refresh();

    expect($intent->target_type)->toBe('user')
        ->and($intent->target_id)->toBe($user->id)
        ->and($intent->target)->toBeInstanceOf(User::class)
        ->and($intent->target->is($user))->toBeTrue();
});

it('is removed together with its uploader and listed on the user', function (): void {
    $user = User::factory()->create();
    UploadIntent::factory()->for($user)->count(2)->create();

    expect($user->uploadIntents)->toHaveCount(2);

    $user->forceDelete();

    expect(UploadIntent::query()->count())->toBe(0);
});
