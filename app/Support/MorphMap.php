<?php

declare(strict_types=1);

namespace App\Support;

use App\Domain\Catalog\Models\EdgeBand;
use App\Domain\Catalog\Models\Finish;
use App\Domain\Catalog\Models\HardwareItem;
use App\Domain\Catalog\Models\LabourRate;
use App\Domain\Catalog\Models\Material;
use App\Domain\Catalog\Models\TaxRate;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\NotificationDelivery;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\PlanRevision;
use App\Domain\Projects\Models\Project;
use App\Domain\Settings\Models\AppSetting;
use App\Domain\Settings\Models\BusinessProfile;
use App\Domain\Shared\Models\UploadIntent;
use Illuminate\Database\Eloquent\Model;

/**
 * Morph aliases (P1-D2), enforced in `AppServiceProvider::boot` so no class name is ever stored in a
 * `*_type` column. Every model task appends its aliases here; `MorphMapTest` fails when a model
 * under `app/Domain/*\/Models` is missing.
 */
final class MorphMap
{
    /** @var array<string, class-string<Model>> */
    public const array MAP = [
        'user' => User::class,
        'address' => Address::class,
        'otp_code' => OtpCode::class,
        'notification_preference' => NotificationPreference::class,
        'staff_invitation' => StaffInvitation::class,
        'upload_intent' => UploadIntent::class,
        'notification_delivery' => NotificationDelivery::class,
        'app_setting' => AppSetting::class,
        'business_profile' => BusinessProfile::class,
        'project' => Project::class,
        'plan' => Plan::class,
        'plan_revision' => PlanRevision::class,
        'material' => Material::class,
        'edge_band' => EdgeBand::class,
        'hardware_item' => HardwareItem::class,
        'finish' => Finish::class,
        'labour_rate' => LabourRate::class,
        'tax_rate' => TaxRate::class,
    ];
}
