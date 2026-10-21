<?php

declare(strict_types=1);

namespace App\Support;

use App\Domain\Ai\Models\AiCreditLedgerEntry;
use App\Domain\Ai\Models\AiUsageEvent;
use App\Domain\Catalog\Models\EdgeBand;
use App\Domain\Catalog\Models\Finish;
use App\Domain\Catalog\Models\HardwareItem;
use App\Domain\Catalog\Models\LabourRate;
use App\Domain\Catalog\Models\Material;
use App\Domain\Catalog\Models\TaxRate;
use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Furniture\Models\FurniturePreset;
use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Furniture\Models\FurnitureTemplateSetting;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\NotificationDelivery;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Models\Message;
use App\Domain\Messaging\Models\MessageRead;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\ChangeProposalItem;
use App\Domain\Orders\Models\ConfirmationCall;
use App\Domain\Orders\Models\Delivery;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderIssue;
use App\Domain\Orders\Models\OrderItem;
use App\Domain\Orders\Models\Payment;
use App\Domain\Orders\Models\ProductionUpdate;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\Models\QuoteLine;
use App\Domain\Orders\Models\QuoteNegotiation;
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
        'furniture_design' => FurnitureDesign::class,
        'furniture_revision' => FurnitureRevision::class,
        'furniture_preset' => FurniturePreset::class,
        'furniture_template_setting' => FurnitureTemplateSetting::class,
        'blueprint_import' => BlueprintImport::class,
        'order' => Order::class,
        'order_item' => OrderItem::class,
        'change_proposal' => ChangeProposal::class,
        'change_proposal_item' => ChangeProposalItem::class,
        'quote' => Quote::class,
        'quote_line' => QuoteLine::class,
        'quote_negotiation' => QuoteNegotiation::class,
        'confirmation_call' => ConfirmationCall::class,
        'production_update' => ProductionUpdate::class,
        'order_issue' => OrderIssue::class,
        'delivery' => Delivery::class,
        'payment' => Payment::class,
        'message' => Message::class,
        'message_read' => MessageRead::class,
        'ai_credit_ledger_entry' => AiCreditLedgerEntry::class,
        'ai_usage_event' => AiUsageEvent::class,
    ];
}
