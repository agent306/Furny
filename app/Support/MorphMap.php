<?php

declare(strict_types=1);

namespace App\Support;

use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\NotificationDelivery;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
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
    ];
}
