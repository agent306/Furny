<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

/**
 * One entry of `notifications.whatsapp_templates` (12 §7.5), keyed by `event_key` (customer) or
 * `event_key@staff`. Components stay in the Cloud API shape: `{type: 'body', params: string[]}` or
 * `{type: 'button', sub_type: 'url', index: int, param: string}`.
 */
final class WhatsAppTemplateData extends SettingsItemData
{
    /**
     * @param  list<array<string, mixed>>  $components
     */
    public function __construct(
        public string $name,
        public string $language,
        public array $components,
    ) {}
}
