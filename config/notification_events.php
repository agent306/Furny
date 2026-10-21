<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Notification event catalogue (12 §5)
|--------------------------------------------------------------------------
|
| `categories` groups events in the preference UI (display order; labels are
| notifications.categories.{key}). `events` is filled by the notification phase (P8).
| Must stay closure-free so that config:cache works.
*/

return [
    'categories' => [
        'orders' => [
            'order.submitted', 'order.assigned', 'order.review_started', 'order.reopened', 'order.items_changed',
            'order.on_hold', 'order.resumed', 'order.cancelled', 'order.closed', 'reminder.action_required',
        ],
        'changes' => ['order.changes_proposed', 'order.changes_resolved', 'order.changes_withdrawn'],
        'quotes' => [
            'quote.sent', 'quote.negotiation_opened', 'quote.negotiation_answered', 'quote.accepted', 'quote.declined',
            'quote.expiring_soon', 'quote.expired', 'order.reopened_after_call',
        ],
        'production' => [
            'order.confirmed', 'order.production_started', 'order.production_update', 'order.completed',
            'order.customer_approved', 'order.issue_raised', 'order.issue_resolved', 'order.delivery_scheduled',
            'order.delivered',
        ],
        'messages' => ['message.posted', 'call.no_answer', 'call.callback_due'],
        'imports_ai' => [
            'import.ready_for_review', 'import.failed', 'ai.credits_granted', 'ai.credits_refunded', 'ai.credits_low',
        ],
        'staff' => ['staff.daily_digest', 'ai.budget_threshold_reached', 'ai.provider_unavailable'],
    ],

    'events' => [],
];
