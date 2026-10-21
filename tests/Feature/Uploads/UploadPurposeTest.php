<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Domain\Shared\Enums\UploadPurpose;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Tests\Support\PolicyActors;

const PURPOSE_MB = 1024 * 1024;

it('describes every purpose as 13 §11.1 does', function (UploadPurpose $purpose, array $types, int $maxBytes, bool $reencodes, ?int $maxEdge, bool $square, ?string $targetType): void {
    expect($purpose->allowedSniffedTypes())->toBe($types)
        ->and($purpose->maxBytes())->toBe($maxBytes)
        ->and($purpose->reencodes())->toBe($reencodes)
        ->and($purpose->maxEdge())->toBe($maxEdge)
        ->and($purpose->squares())->toBe($square)
        ->and($purpose->targetType())->toBe($targetType);
})->with([
    'blueprint_source' => [UploadPurpose::BlueprintSource, ['jpeg', 'png', 'webp', 'heic', 'pdf', 'dxf'], 25 * PURPOSE_MB, false, null, false, 'project'],
    'message_attachment' => [UploadPurpose::MessageAttachment, ['jpeg', 'png', 'webp', 'pdf'], 15 * PURPOSE_MB, true, 4096, false, 'order'],
    'production_photo' => [UploadPurpose::ProductionPhoto, ['jpeg', 'png', 'webp', 'heic'], 15 * PURPOSE_MB, true, 4096, false, 'order'],
    'issue_photo' => [UploadPurpose::IssuePhoto, ['jpeg', 'png', 'webp', 'heic'], 15 * PURPOSE_MB, true, 4096, false, 'order'],
    'delivery_photo' => [UploadPurpose::DeliveryPhoto, ['jpeg', 'png', 'webp', 'heic'], 15 * PURPOSE_MB, true, 4096, false, 'order'],
    'avatar' => [UploadPurpose::Avatar, ['jpeg', 'png', 'webp'], 5 * PURPOSE_MB, true, 512, false, null],
    'business_logo' => [UploadPurpose::BusinessLogo, ['png', 'webp', 'jpeg'], 2 * PURPOSE_MB, true, 1024, false, null],
    'material_texture' => [UploadPurpose::MaterialTexture, ['jpeg', 'webp'], 4 * PURPOSE_MB, true, 1024, true, null],
    'finish_texture' => [UploadPurpose::FinishTexture, ['jpeg', 'webp'], 4 * PURPOSE_MB, true, 1024, true, null],
    'hardware_image' => [UploadPurpose::HardwareImage, ['jpeg', 'png', 'webp'], 4 * PURPOSE_MB, true, 1600, false, null],
    'plan_thumbnail' => [UploadPurpose::PlanThumbnail, ['png'], 5 * PURPOSE_MB, true, null, false, 'plan'],
    'project_cover' => [UploadPurpose::ProjectCover, ['png', 'webp'], 5 * PURPOSE_MB, true, null, false, 'project'],
    'furniture_thumbnail' => [UploadPurpose::FurnitureThumbnail, ['png'], 5 * PURPOSE_MB, true, null, false, 'furniture_design'],
    'preset_thumbnail' => [UploadPurpose::PresetThumbnail, ['png'], 5 * PURPOSE_MB, true, null, false, null],
]);

it('limits DXF blueprints to 15 MB and nothing else by extension', function (): void {
    expect(UploadPurpose::BlueprintSource->maxBytes('dxf'))->toBe(15 * PURPOSE_MB)
        ->and(UploadPurpose::BlueprintSource->maxBytes('pdf'))->toBe(25 * PURPOSE_MB)
        ->and(UploadPurpose::BlueprintSource->maxBytes('DXF'))->toBe(15 * PURPOSE_MB)
        ->and(UploadPurpose::Avatar->maxBytes('dxf'))->toBe(5 * PURPOSE_MB);
});

it('lists the declared MIME types its sniffed types go by', function (): void {
    expect(UploadPurpose::Avatar->allowedDeclaredMimes())->toBe(['image/jpeg', 'image/png', 'image/webp'])
        ->and(UploadPurpose::PlanThumbnail->allowedDeclaredMimes())->toBe(['image/png'])
        ->and(UploadPurpose::ProductionPhoto->allowedDeclaredMimes())->toBe(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
        ->and(UploadPurpose::BlueprintSource->allowedDeclaredMimes())->toContain(
            'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
            'image/vnd.dxf', 'application/dxf', 'application/x-dxf', 'image/x-dxf', 'application/octet-stream', 'text/plain',
        );

    foreach (UploadPurpose::cases() as $purpose) {
        expect($purpose->allowedDeclaredMimes())->not->toContain('image/svg+xml')->not->toContain('image/gif');
    }
});

it('maps every purpose to a morph alias that exists', function (): void {
    foreach (UploadPurpose::cases() as $purpose) {
        if ($purpose->targetType() !== null) {
            expect(Relation::getMorphedModel($purpose->targetType()))->not->toBeNull();
        }
    }
});

/** @return array{bool, int|null} */
function purposeOutcome(UploadPurpose $purpose, User $user, ?Model $target): array
{
    try {
        $purpose->authorizeTarget($user, $target);

        return [true, null];
    } catch (AuthorizationException $e) {
        return [false, $e->status()];
    }
}

it('authorises a blueprint upload like a trace import on the project', function (string $actor, bool|int|null $expected): void {
    $project = Project::factory()->create();

    expect(purposeOutcome(UploadPurpose::BlueprintSource, PolicyActors::resolve($actor, $project->owner), $project))->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::PLAN_EDITORS)));

it('authorises a project cover like an update of the project', function (string $actor, bool|int|null $expected): void {
    $project = Project::factory()->create();

    expect(purposeOutcome(UploadPurpose::ProjectCover, PolicyActors::resolve($actor, $project->owner), $project))->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::MANAGERS)));

it('authorises a plan thumbnail like an update of the plan', function (string $actor, bool|int|null $expected): void {
    $plan = Plan::factory()->create();

    expect(purposeOutcome(UploadPurpose::PlanThumbnail, PolicyActors::resolve($actor, $plan->project->owner), $plan))->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::PLAN_EDITORS)));

it('authorises a furniture thumbnail like an update of the design', function (string $actor, bool|int|null $expected): void {
    $design = FurnitureDesign::factory()->create();

    expect(purposeOutcome(UploadPurpose::FurnitureThumbnail, PolicyActors::resolve($actor, $design->project->owner), $design))->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::PLAN_EDITORS)));

it('authorises production and delivery photos like production management', function (UploadPurpose $purpose, string $actor, bool|int|null $expected): void {
    $order = Order::factory()->create();

    expect(purposeOutcome($purpose, PolicyActors::resolve($actor, $order->customer), $order))->toBe(PolicyActors::outcome($expected));
})->with(function (): iterable {
    foreach ([UploadPurpose::ProductionPhoto, UploadPurpose::DeliveryPhoto] as $purpose) {
        foreach (PolicyActors::rows(PolicyActors::staffOnly(['staff-owner', 'admin', 'production'])) as $actor => [$name, $expected]) {
            yield "{$purpose->value} {$actor}" => [$purpose, $name, $expected];
        }
    }
});

it('authorises an issue photo like reporting an issue, or raising one on behalf', function (string $actor, bool|int|null $expected): void {
    $order = Order::factory()->create();

    expect(purposeOutcome(UploadPurpose::IssuePhoto, PolicyActors::resolve($actor, $order->customer), $order))->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(array_replace(
    ['customer' => true, 'other-customer' => 404, 'inactive-admin' => null],
    array_fill_keys(PolicyActors::STAFF, 403),
    ['staff-owner' => true, 'admin' => true],
)));

it('authorises a message attachment like posting a message', function (string $actor, bool|int|null $expected): void {
    $order = Order::factory()->create();

    expect(purposeOutcome(UploadPurpose::MessageAttachment, PolicyActors::resolve($actor, $order->customer), $order))->toBe(PolicyActors::outcome($expected));
})->with(fn (): array => PolicyActors::rows(PolicyActors::ownerOrStaff(PolicyActors::STAFF)));

it('asks the permission of the staff purposes and nothing of an avatar', function (UploadPurpose $purpose, array $allowed): void {
    foreach (['customer', 'staff-owner', 'admin', 'estimator', 'production', 'support'] as $actor) {
        $user = PolicyActors::resolve($actor, User::factory()->create());

        expect(purposeOutcome($purpose, $user, null))->toBe(in_array($actor, $allowed, true) ? [true, null] : [false, 403], "{$purpose->value} / {$actor}");
    }
})->with([
    'avatar' => [UploadPurpose::Avatar, ['customer', 'staff-owner', 'admin', 'estimator', 'production', 'support']],
    'business_logo' => [UploadPurpose::BusinessLogo, ['staff-owner', 'admin']],
    'material_texture' => [UploadPurpose::MaterialTexture, ['staff-owner', 'admin']],
    'finish_texture' => [UploadPurpose::FinishTexture, ['staff-owner', 'admin']],
    'hardware_image' => [UploadPurpose::HardwareImage, ['staff-owner', 'admin']],
    'preset_thumbnail' => [UploadPurpose::PresetThumbnail, ['staff-owner', 'admin', 'estimator']],
]);

it('refuses a purpose that needs a target when none is given', function (): void {
    expect(fn () => UploadPurpose::ProjectCover->authorizeTarget(User::factory()->create(), null))->toThrow(LogicException::class);
});
