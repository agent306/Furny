<?php

declare(strict_types=1);

return [
    'title' => 'Hello, {name}',

    // Placeholders until the dashboard widgets arrive (10 §6, 11 §4).
    'customer' => [
        'empty' => [
            'title' => "Let's start with your home",
            'body' => 'Create a project, then upload your floor plan or draw it.',
        ],
    ],

    'admin' => [
        'title' => 'Dashboard',
        'placeholder' => [
            'title' => 'Your work queue will appear here',
            'body' => 'Orders that need attention, calls to make and production updates show up on this page.',
        ],
    ],
];
