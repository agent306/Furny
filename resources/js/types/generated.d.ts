declare namespace App {
namespace Domain {
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
namespace Identity {
namespace Enums {
export type DeliveryDriver = 'meta' | 'twilio' | 'msg91' | 'log' | 'array';
export type DeliveryStatus = 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
export type LengthUnit = 'mm' | 'cm' | 'm' | 'ftin' | 'in';
export type OtpChannel = 'whatsapp' | 'sms';
export type OtpPurpose = 'login' | 'verify_phone';
export type StaffRole = 'owner' | 'admin' | 'estimator' | 'production' | 'support';
export type UnitSystem = 'metric' | 'imperial';
export type UserType = 'customer' | 'staff';
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
namespace Shared {
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
