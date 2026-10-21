<?php

declare(strict_types=1);

namespace App\Domain\Shared\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `upload_intents.purpose`: the exhaustive list of 13 §11.1. */
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
}
