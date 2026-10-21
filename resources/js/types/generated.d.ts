declare namespace App {
namespace Domain {
namespace Ai {
namespace Enums {
export type AiFeature = 'blueprint_recognition' | 'provider_test';
export type AiProvider = 'anthropic' | 'openai' | 'openai_compatible' | 'none';
export type AiUsageStatus = 'succeeded' | 'failed';
export type CreditLedgerKind = 'monthly_grant' | 'admin_grant' | 'admin_revoke' | 'reservation' | 'reservation_release' | 'consumption' | 'refund' | 'signup_grant';
}
}
namespace Catalog {
namespace Enums {
export type BoardType = 'particle_board' | 'mdf' | 'hdf' | 'plywood' | 'blockboard' | 'solid_wood' | 'glass' | 'acrylic' | 'metal_sheet';
export type FinishType = 'none' | 'laminate' | 'veneer' | 'paint' | 'pu' | 'lacquer' | 'duco' | 'membrane';
export type HardwareCategory = 'hinge' | 'hinge_plate' | 'drawer_slide' | 'handle' | 'knob' | 'leg' | 'plinth_leg' | 'hanging_rod' | 'rod_support' | 'shelf_support' | 'connector' | 'lock' | 'lift_mechanism' | 'sliding_track' | 'sliding_roller' | 'gas_strut' | 'damper' | 'screw_pack' | 'wall_bracket' | 'led_strip' | 'other';
export type HardwareUnit = 'piece' | 'pair' | 'set' | 'meter' | 'pack';
export type LabourUnit = 'sheet' | 'meter' | 'part' | 'piece' | 'item' | 'sqm' | 'hour';
export type MaterialSurface = 'raw' | 'melamine' | 'laminate' | 'veneer' | 'painted' | 'lacquered' | 'pre_laminated';
}
}
namespace Furniture {
namespace Enums {
export type AuthorKind = 'customer' | 'staff';
export type BomStatus = 'pending' | 'ready' | 'failed';
export type FurnitureRevisionReason = 'manual_checkpoint' | 'order_submitted' | 'staff_proposal' | 'proposal_applied' | 'before_restore';
export type PresetCategory = 'wardrobe' | 'kitchen' | 'storage' | 'shelving' | 'tv_unit' | 'table' | 'desk' | 'bed' | 'other';
}
}
namespace Identity {
namespace Data {
export type AuthUserData = {
id: string,
type: App.Domain.Identity.Enums.UserType,
name: string,
email: string | null,
emailVerified: boolean,
phoneE164: string | null,
phoneVerified: boolean,
avatarUrl: string | null,
roles: string[],
permissions: string[],
abilities: string[],
unitSystem: App.Domain.Identity.Enums.UnitSystem,
lengthUnit: App.Domain.Identity.Enums.LengthUnit,
timezone: string,
locale: string,
onboarded: boolean,
hasPassword: boolean,
twoFactorEnabled: boolean,
};
export type StaffInvitationRowData = {
id: string,
email: string,
name: string,
role: string,
invitedBy: App.Domain.Identity.Data.UserRefData | null,
expiresAt: string,
expired: boolean,
createdAt: string,
};
export type StaffRowAbilitiesData = {
edit: boolean,
deactivate: boolean,
activate: boolean,
resetTwoFactor: boolean,
};
export type StaffRowData = {
id: string,
name: string,
email: string,
role: string,
twoFactorEnabled: boolean,
twoFactorRequired: boolean,
isActive: boolean,
lastLoginAt: string | null,
googleLinked: boolean,
can: App.Domain.Identity.Data.StaffRowAbilitiesData,
};
export type TwoFactorPageProps = {
enabled: boolean,
confirmed: boolean,
required: boolean,
enforced: boolean,
};
export type UserRefData = {
id: string,
name: string,
avatarUrl: string | null,
isStaff: boolean,
};
}
namespace Enums {
export type DeliveryDriver = 'meta' | 'twilio' | 'msg91' | 'log' | 'array';
export type DeliveryStatus = 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
export type GoogleIntent = 'login' | 'link' | 'invitation' | 'reauthenticate';
export type LengthUnit = 'mm' | 'cm' | 'm' | 'ftin' | 'in';
export type OtpChannel = 'whatsapp' | 'sms';
export type OtpPurpose = 'login' | 'verify_phone';
export type OwnerGate = 'orders.cancel_late' | 'staff.manage_owners' | 'settings.change_currency' | 'settings.manage_restricted' | 'data.delete';
export type PermissionName = 'orders.view' | 'orders.review' | 'orders.assign' | 'orders.propose_changes' | 'quotes.create' | 'quotes.send' | 'quotes.view_costs' | 'orders.confirm' | 'orders.cancel' | 'orders.hold' | 'orders.close' | 'production.manage' | 'messages.post' | 'customers.view' | 'customers.manage' | 'catalog.manage' | 'presets.manage' | 'templates.manage' | 'settings.manage' | 'staff.manage' | 'ai.manage' | 'reports.view' | 'plans.edit_any' | 'audit.view';
export type StaffRole = 'owner' | 'admin' | 'estimator' | 'production' | 'support';
export type UnitSystem = 'metric' | 'imperial';
export type UserType = 'customer' | 'staff';
}
}
namespace Imports {
namespace Enums {
export type ImportMode = 'auto' | 'trace';
export type ImportSourceKind = 'raster' | 'pdf_vector' | 'pdf_raster' | 'dxf' | 'heic';
export type ImportStatus = 'uploaded' | 'queued' | 'preprocessing' | 'recognizing' | 'ready_for_review' | 'accepted' | 'discarded' | 'failed' | 'cancelled';
}
}
namespace Messaging {
namespace Enums {
export type MessageKind = 'text' | 'system' | 'internal_note';
}
}
namespace Orders {
namespace Enums {
export type CallOutcome = 'confirmed' | 'no_answer' | 'callback_requested' | 'wrong_number' | 'customer_wants_changes' | 'customer_declined';
export type CancelReason = 'customer_withdrew' | 'quote_declined' | 'declined_on_call' | 'unresponsive' | 'staff_cancelled' | 'duplicate' | 'other';
export type ChangeProposalStatus = 'draft' | 'sent' | 'resolved' | 'withdrawn';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'rejected';
export type NegotiationStatus = 'open' | 'answered_with_revision' | 'answered_keep_price' | 'closed';
export type OrderStateKey = 'draft' | 'submitted' | 'in_review' | 'changes_proposed' | 'quoted' | 'negotiating' | 'accepted' | 'confirmed' | 'in_production' | 'completed' | 'rework' | 'ready_for_delivery' | 'delivered' | 'closed' | 'cancelled' | 'on_hold';
export type PaymentGateway = 'razorpay' | 'stripe';
export type PaymentKind = 'advance' | 'balance' | 'refund' | 'adjustment';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'upi' | 'card' | 'cheque' | 'online_gateway';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';
export type ProductionVisibility = 'customer' | 'internal';
export type ProposalItemDecision = 'pending' | 'approved' | 'rejected';
export type QuoteLineKind = 'furniture' | 'materials' | 'hardware' | 'labour' | 'finishing' | 'installation' | 'delivery' | 'discount' | 'custom';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'superseded' | 'expired' | 'withdrawn';
}
}
namespace Projects {
namespace Enums {
export type PlanRevisionReason = 'manual_checkpoint' | 'import_accepted' | 'before_restore' | 'staff_edit' | 'auto_daily';
export type PlanSource = 'drawn' | 'imported' | 'traced' | 'duplicated';
export type ProjectStatus = 'active' | 'archived';
export type PropertyType = 'apartment' | 'independent_house' | 'villa' | 'office' | 'other';
}
}
namespace Settings {
namespace Data {
export type BusinessPublicData = {
name: string,
currency: string,
locale: string,
timezone: string,
phoneE164: string | null,
email: string,
workingHours: string,
units: App.Domain.Settings.Data.BusinessUnitsData,
defaultCountryCode: string,
};
export type BusinessUnitsData = {
defaultSystem: App.Domain.Identity.Enums.UnitSystem,
defaultLengthUnit: string,
};
}
}
namespace Shared {
namespace Data {
export type MediaData = {
id: string,
name: string,
mimeType: string,
size: number,
url: string,
thumbUrl: string | null,
largeUrl: string | null,
width: number | null,
height: number | null,
};
export type PresignTargetData = {
type: string,
id: string,
};
export type PresignUploadData = {
purpose: App.Domain.Shared.Enums.UploadPurpose,
filename: string,
size: number,
contentType: string,
target: App.Domain.Shared.Data.PresignTargetData | null,
};
export type UploadIntentStatusData = {
uploadId: string,
status: 'pending' | 'processing' | 'ready' | 'rejected' | 'consumed' | 'expired',
reasonCode: string | null,
previewUrl: string | null,
width: number | null,
height: number | null,
};
export type UploadPresignData = {
uploadId: string,
url: string,
headers: Record<string, string>,
expiresAt: string,
};
}
namespace Enums {
export type NotificationChannel = 'database' | 'mail' | 'whatsapp' | 'sms' | 'webpush';
export type UploadPurpose = 'blueprint_source' | 'message_attachment' | 'production_photo' | 'issue_photo' | 'delivery_photo' | 'avatar' | 'business_logo' | 'material_texture' | 'finish_texture' | 'hardware_image' | 'plan_thumbnail' | 'project_cover' | 'furniture_thumbnail' | 'preset_thumbnail';
export type UploadStatus = 'pending' | 'uploaded' | 'ready' | 'rejected' | 'consumed' | 'expired';
}
}
}
namespace Support {
namespace Settings {
export type SettingsGroup = 'business' | 'units' | 'pricing' | 'workflow' | 'ai' | 'notifications' | 'auth';
namespace Groups {
export type AiPriceRowData = {
provider: string,
model: string,
inputPerMtokUsd: string,
outputPerMtokUsd: string,
};
export type AiSettings = {
provider: string,
model: string,
effort: string,
agenticCrops: boolean,
fallbackToNoneOnError: boolean,
signupCredits: number,
monthlyCredits: number,
creditsPerRecognition: number,
creditsPerRecognitionNone: number,
maxRecognitionsPerDay: number,
globalMonthlyBudgetUsd: string,
budgetExhaustedBehavior: string,
priceTable: App.Support.Settings.Groups.AiPriceRowData[],
staffUnlimited: boolean,
};
export type AuthSettings = {
allowCustomerRegistration: boolean,
otpAllowedCountryCodes: string[],
otpGlobalHourlyCap: number,
staffSessionAbsoluteHours: number,
};
export type BusinessSettings = {
name: string,
legalName: string | null,
taxId: string | null,
email: string,
phoneE164: string | null,
address: Record<string, any> | null,
currency: string,
locale: string,
timezone: string,
logoMediaId: number | null,
quoteTerms: string,
workingHours: string,
};
export type NotificationsSettings = {
whatsappTemplates: Record<string, App.Support.Settings.Groups.WhatsAppTemplateData>,
smsDriver: string,
smsTemplates: Record<string, App.Support.Settings.Groups.SmsTemplateData>,
otpChannelOrder: string[],
staffDigestHour: number,
quietHours: App.Support.Settings.Groups.QuietHoursData,
};
export type PricingSettings = {
pricesIncludeTax: boolean,
defaultTaxRateId: string | null,
marginBps: number,
overheadBps: number,
minimumOrderMinor: number,
roundingMinor: number,
estimateDisclaimerKey: string,
installationBps: number,
deliveryFlatMinor: number,
kerfMm: number,
sheetTrimMm: number,
nestingAllowRotationDefault: boolean,
sheetBillingMode: string,
edgePremillMm: number,
};
export type ProductionStageData = {
key: string,
labelKey: string | null,
label: string | null,
defaultProgress: number,
};
export type QuietHoursData = {
enabled: boolean,
start: string,
end: string,
};
export type SettingsData = object;
export type SettingsItemData = object;
export type SmsTemplateData = {
textKey: string,
dltTemplateId: string | null,
providerTemplateId: string | null,
};
export type UnitsSettings = {
defaultSystem: string,
defaultLengthUnit: string,
defaultWallHeightMm: number,
defaultExteriorWallThicknessMm: number,
defaultInteriorWallThicknessMm: number,
defaultDoorWidthMm: number,
defaultDoorHeightMm: number,
defaultWindowWidthMm: number,
defaultWindowHeightMm: number,
defaultWindowSillMm: number,
};
export type WhatsAppTemplateData = {
name: string,
language: string,
components: Record<string, any>[],
};
export type WorkflowSettings = {
quoteValidityDays: number,
autoCloseDays: number,
reminderAfterHours: number,
productionStages: App.Support.Settings.Groups.ProductionStageData[],
requireCompletionPhotos: number,
allowCustomerCounterOffer: boolean,
maxNegotiationRounds: number,
minPreferredDeliveryDays: number,
};
}
}
}
}
declare namespace Illuminate {
export type CursorPaginator<TKey, TValue> = {
data: TKey extends string ? Record<TKey, TValue> : TValue[],
links: {
url: string | null,
label: string,
active: boolean,
}[],
meta: {
path: string,
per_page: number,
next_cursor: string | null,
next_page_url: string | null,
prev_cursor: string | null,
prev_page_url: string | null,
},
};
export type CursorPaginatorInterface<TKey, TValue> = Illuminate.CursorPaginator<TKey, TValue>;
export type LengthAwarePaginator<TKey, TValue> = {
data: TKey extends string ? Record<TKey, TValue> : TValue[],
links: {
url: string | null,
label: string,
active: boolean,
}[],
meta: {
total: number,
current_page: number,
first_page_url: string,
from: number | null,
last_page: number,
last_page_url: string,
next_page_url: string | null,
path: string,
per_page: number,
prev_page_url: string | null,
to: number | null,
},
};
export type LengthAwarePaginatorInterface<TKey, TValue> = Illuminate.LengthAwarePaginator<TKey, TValue>;
}
declare namespace Spatie {
namespace LaravelData {
export type CursorPaginatedDataCollection<TKey, TValue> = Illuminate.CursorPaginator<TKey, TValue>;
export type PaginatedDataCollection<TKey, TValue> = Illuminate.LengthAwarePaginator<TKey, TValue>;
}
}
