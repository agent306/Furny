<?php

declare(strict_types=1);

namespace App\Domain\Shared\Enums;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Enums\ImportMode;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\Order;
use App\Domain\Projects\Models\Project;
use App\Support\Uploads\MagicBytes;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Gate;
use LogicException;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * `upload_intents.purpose`: the exhaustive list of 13 §11.1, with the rules of each row of its table: what may be uploaded,
 * how large, how the image is treated, and who may upload against which target.
 */
#[TypeScript]
enum UploadPurpose: string
{
    case BlueprintSource = 'blueprint_source';
    case MessageAttachment = 'message_attachment';
    case ProductionPhoto = 'production_photo';
    case IssuePhoto = 'issue_photo';
    case DeliveryPhoto = 'delivery_photo';
    case Avatar = 'avatar';
    case BusinessLogo = 'business_logo';
    case MaterialTexture = 'material_texture';
    case FinishTexture = 'finish_texture';
    case HardwareImage = 'hardware_image';
    case PlanThumbnail = 'plan_thumbnail';
    case ProjectCover = 'project_cover';
    case FurnitureThumbnail = 'furniture_thumbnail';
    case PresetThumbnail = 'preset_thumbnail';

    private const int MB = 1024 * 1024;

    /**
     * The sniffed types (`MagicBytes`) the purpose takes.
     *
     * @return list<string>
     */
    public function allowedSniffedTypes(): array
    {
        return match ($this) {
            self::BlueprintSource => ['jpeg', 'png', 'webp', 'heic', 'pdf', 'dxf'],
            self::MessageAttachment => ['jpeg', 'png', 'webp', 'pdf'],
            self::ProductionPhoto, self::IssuePhoto, self::DeliveryPhoto => ['jpeg', 'png', 'webp', 'heic'],
            self::Avatar, self::HardwareImage => ['jpeg', 'png', 'webp'],
            self::BusinessLogo => ['png', 'webp', 'jpeg'],
            self::MaterialTexture, self::FinishTexture => ['jpeg', 'webp'],
            self::ProjectCover => ['png', 'webp'],
            self::PlanThumbnail, self::FurnitureThumbnail, self::PresetThumbnail => ['png'],
        };
    }

    /**
     * The MIME types a browser may declare at presign. A blueprint also takes the two generic ones, which
     * `CreateUploadIntent` lets through only with a matching `.dxf`/`.heic` extension (06 §2.1).
     *
     * @return list<string>
     */
    public function allowedDeclaredMimes(): array
    {
        $mimes = array_merge(...array_map(MagicBytes::declaredMimes(...), $this->allowedSniffedTypes()));

        return array_values(array_unique($this === self::BlueprintSource ? [...$mimes, 'application/octet-stream', 'text/plain'] : $mimes));
    }

    /** The size limit in bytes; DXF blueprints are held to 15 MB (06 §2.1), whatever the extension's case. */
    public function maxBytes(?string $extension = null): int
    {
        return match ($this) {
            self::BlueprintSource => strtolower((string) $extension) === 'dxf' ? 15 * self::MB : 25 * self::MB,
            self::MessageAttachment, self::ProductionPhoto, self::IssuePhoto, self::DeliveryPhoto => 15 * self::MB,
            self::BusinessLogo => 2 * self::MB,
            self::MaterialTexture, self::FinishTexture, self::HardwareImage => 4 * self::MB,
            self::Avatar, self::PlanThumbnail, self::ProjectCover, self::FurnitureThumbnail, self::PresetThumbnail => 5 * self::MB,
        };
    }

    /** Whether the images of the purpose are decoded and written again; a blueprint keeps its original bytes (vision needs them). */
    public function reencodes(): bool
    {
        return $this !== self::BlueprintSource;
    }

    /** The longest edge in pixels; null where 13 §11.1 sets none. */
    public function maxEdge(): ?int
    {
        return match ($this) {
            self::Avatar => 512,
            self::BusinessLogo, self::MaterialTexture, self::FinishTexture => 1024,
            self::HardwareImage => 1600,
            self::MessageAttachment, self::ProductionPhoto, self::IssuePhoto, self::DeliveryPhoto => 4096,
            self::BlueprintSource, self::PlanThumbnail, self::ProjectCover, self::FurnitureThumbnail, self::PresetThumbnail => null,
        };
    }

    /** Textures are cut square and resized to `maxEdge()` pixels a side. */
    public function squares(): bool
    {
        return $this === self::MaterialTexture || $this === self::FinishTexture;
    }

    /**
     * The morph alias of the model the upload is authorised against; null when the purpose has none (own account, or a
     * staff permission). A preset thumbnail has none either: a preset that is being saved does not exist yet.
     */
    public function targetType(): ?string
    {
        return match ($this) {
            self::BlueprintSource, self::ProjectCover => 'project',
            self::MessageAttachment, self::ProductionPhoto, self::IssuePhoto, self::DeliveryPhoto => 'order',
            self::PlanThumbnail => 'plan',
            self::FurnitureThumbnail => 'furniture_design',
            self::Avatar, self::BusinessLogo, self::MaterialTexture, self::FinishTexture, self::HardwareImage, self::PresetThumbnail => null,
        };
    }

    /**
     * The authorisation of the table in 13 §11.1: a policy ability on the target, or a staff permission. The policies
     * answer 404 for a customer who must not know the record exists and 403 otherwise.
     *
     * @throws AuthorizationException
     */
    public function authorizeTarget(User $user, ?Model $target): void
    {
        $gate = Gate::forUser($user);

        match ($this) {
            self::BlueprintSource => $gate->authorize('create', [BlueprintImport::class, $this->target($target, Project::class), ImportMode::Trace]),
            self::MessageAttachment => $gate->authorize('create', [Message::class, $this->target($target, Order::class)]),
            self::ProductionPhoto, self::DeliveryPhoto => $gate->authorize('manageProduction', $this->target($target, Order::class)),
            self::IssuePhoto => $gate->authorize($user->isStaff() ? 'raiseIssueOnBehalf' : 'reportIssue', $this->target($target, Order::class)),
            self::Avatar => null,
            self::BusinessLogo => $this->requirePermission($user, PermissionName::SettingsManage),
            self::MaterialTexture, self::FinishTexture, self::HardwareImage => $this->requirePermission($user, PermissionName::CatalogManage),
            self::PlanThumbnail, self::ProjectCover, self::FurnitureThumbnail => $gate->authorize('update', $this->target($target, $this->targetClass())),
            self::PresetThumbnail => $this->requirePermission($user, PermissionName::PresetsManage),
        };
    }

    /** @return class-string<Model> */
    private function targetClass(): string
    {
        $class = $this->targetType() === null ? null : Relation::getMorphedModel($this->targetType());

        return $class ?? throw new LogicException("The upload purpose [{$this->value}] has no target model.");
    }

    /**
     * @template T of Model
     *
     * @param  class-string<T>  $class
     * @return T
     */
    private function target(?Model $target, string $class): Model
    {
        if (! $target instanceof $class) {
            throw new LogicException("The upload purpose [{$this->value}] needs a [{$class}] as its target.");
        }

        return $target;
    }

    private function requirePermission(User $user, PermissionName $permission): void
    {
        if (! $user->can($permission->value)) {
            throw (new AuthorizationException)->withStatus(403);
        }
    }
}
