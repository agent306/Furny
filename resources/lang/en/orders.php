<?php

declare(strict_types=1);

// Order state labels: 09 §1 "Label (en)" (staff), 09 §1 "Customer sees as"
// (full sentence, used as aria-label) and 15 §9.3 (short badge label).
return [
    'states' => [
        'draft' => 'Draft',
        'submitted' => 'Submitted',
        'in_review' => 'In review',
        'changes_proposed' => 'Changes proposed',
        'quoted' => 'Quote sent',
        'negotiating' => 'Negotiating',
        'accepted' => 'Quote accepted',
        'confirmed' => 'Confirmed',
        'in_production' => 'In production',
        'completed' => 'Completed — awaiting your check',
        'rework' => 'Rework',
        'ready_for_delivery' => 'Ready for delivery',
        'delivered' => 'Delivered',
        'closed' => 'Closed',
        'cancelled' => 'Cancelled',
        'on_hold' => 'On hold',
    ],

    'states_customer' => [
        'draft' => 'Draft — not sent yet',
        'submitted' => 'Waiting for review',
        'in_review' => 'Our team is reviewing your designs',
        'changes_proposed' => 'Action needed: review our suggested changes',
        'quoted' => 'Action needed: review your quote',
        'negotiating' => "We're reviewing your response",
        'accepted' => "Accepted — we'll call you to confirm",
        'confirmed' => 'Confirmed — production will start soon',
        'in_production' => 'In production',
        'completed' => 'Action needed: check the photos of your furniture',
        'rework' => "We're fixing the issue you reported",
        'ready_for_delivery' => 'Ready for delivery',
        'delivered' => 'Delivered',
        'closed' => 'Closed',
        'cancelled' => 'Cancelled',
        'on_hold' => 'On hold',
    ],

    'states_customer_short' => [
        'draft' => 'Draft',
        'submitted' => 'Waiting for review',
        'in_review' => 'In review',
        'changes_proposed' => 'Action needed',
        'quoted' => 'Quote ready',
        'negotiating' => 'Under discussion',
        'accepted' => 'Accepted',
        'confirmed' => 'Confirmed',
        'in_production' => 'In production',
        'completed' => 'Check your furniture',
        'rework' => 'Fixing an issue',
        'ready_for_delivery' => 'Ready for delivery',
        'delivered' => 'Delivered',
        'closed' => 'Closed',
        'cancelled' => 'Cancelled',
        'on_hold' => 'On hold',
    ],
];
