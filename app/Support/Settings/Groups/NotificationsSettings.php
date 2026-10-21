<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

use Spatie\LaravelData\Attributes\DataCollectionOf;

/**
 * `notifications` (02 §13). `sms_templates` is seeded with the twelve SMS events; `sms_driver` is
 * `twilio|msg91|log`.
 */
final class NotificationsSettings extends SettingsData
{
    /** Event keys that have an SMS text (02 §13); `auth.otp` uses its own text key. */
    public const array SMS_EVENT_KEYS = [
        'order.changes_proposed',
        'quote.sent',
        'quote.negotiation_answered',
        'quote.expiring_soon',
        'order.confirmed',
        'order.production_started',
        'order.completed',
        'order.delivery_scheduled',
        'order.cancelled',
        'call.no_answer',
        'reminder.action_required',
        'auth.otp',
    ];

    /**
     * @param  array<string, WhatsAppTemplateData>  $whatsappTemplates
     * @param  array<string, SmsTemplateData>  $smsTemplates
     * @param  list<string>  $otpChannelOrder
     */
    public function __construct(
        #[DataCollectionOf(WhatsAppTemplateData::class)]
        public array $whatsappTemplates,
        public string $smsDriver,
        #[DataCollectionOf(SmsTemplateData::class)]
        public array $smsTemplates,
        public array $otpChannelOrder,
        public int $staffDigestHour,
        public QuietHoursData $quietHours,
    ) {}

    public static function defaults(): static
    {
        $smsTemplates = [];

        foreach (self::SMS_EVENT_KEYS as $key) {
            $smsTemplates[$key] = new SmsTemplateData(
                textKey: $key === 'auth.otp' ? 'notifications.auth.otp.sms' : "notifications.{$key}.customer.sms",
                dltTemplateId: null,
                providerTemplateId: null,
            );
        }

        return new self(
            whatsappTemplates: [],
            smsDriver: 'log',
            smsTemplates: $smsTemplates,
            otpChannelOrder: ['whatsapp', 'sms'],
            staffDigestHour: 9,
            quietHours: new QuietHoursData(true, '21:00', '08:00'),
        );
    }

    protected static function mapProperties(): array
    {
        return ['whatsappTemplates', 'smsTemplates'];
    }
}
