<?php

declare(strict_types=1);

return [
    'copy_failed' => 'Could not copy. Please copy it by hand.',
    'load_failed' => "We couldn't load this.",
    'status_code' => 'Error {status}',
    'rate_limited' => 'Too many attempts. Try again in {seconds, plural, one {# second} other {# seconds}}.',

    // The Error page (10 §4.10); the key segment is the HTTP status.
    'pages' => [
        '403' => "You don't have access to this page.",
        '404' => "We couldn't find that page.",
        '405' => "That action isn't available here.",
        '419' => 'Your session expired. Please reload.',
        '429' => 'Too many requests. Please wait a moment.',
        '500' => 'Something went wrong on our side.',
        '503' => "We're doing maintenance. Back shortly.",
    ],

    'actions' => [
        'go_dashboard' => 'Go to dashboard',
        'go_home' => 'Go to the home page',
        'reload' => 'Reload',
    ],
];
