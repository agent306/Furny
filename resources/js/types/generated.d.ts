declare namespace App {
namespace Domain {
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
namespace Shared {
namespace Enums {
export type NotificationChannel = 'database' | 'mail' | 'whatsapp' | 'sms' | 'webpush';
export type UploadPurpose = 'blueprint_source' | 'message_attachment' | 'production_photo' | 'issue_photo' | 'delivery_photo' | 'avatar' | 'business_logo' | 'material_texture' | 'finish_texture' | 'hardware_image' | 'plan_thumbnail' | 'project_cover' | 'furniture_thumbnail' | 'preset_thumbnail';
export type UploadStatus = 'pending' | 'uploaded' | 'ready' | 'rejected' | 'consumed' | 'expired';
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
