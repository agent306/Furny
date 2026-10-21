<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

/**
 * One entry of `notifications.sms_templates` (12 §3.7, §7): the text lives in `resources/lang`
 * under `textKey`; the DLT and provider ids are entered by the owner.
 */
final class SmsTemplateData extends SettingsItemData
{
    public function __construct(
        public string $textKey,
        public ?string $dltTemplateId,
        public ?string $providerTemplateId,
    ) {}
}
