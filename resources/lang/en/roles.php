<?php

declare(strict_types=1);

return [
    // Role names shown as badges; the key segment is the StaffRole value.
    'names' => [
        'owner' => 'Owner',
        'admin' => 'Admin',
        'estimator' => 'Estimator',
        'production' => 'Production',
        'support' => 'Support',
    ],

    // What each role is for, shown where a role is chosen (11 §7).
    'descriptions' => [
        'owner' => 'Full access, including the settings and data deletion only an owner may use.',
        'admin' => 'Runs the business day to day: orders, catalog, settings and staff.',
        'estimator' => 'Reviews orders, prepares quotes and proposes changes to designs.',
        'production' => 'Runs production: stages, updates, issues and delivery.',
        'support' => 'Answers customers and logs calls. Cannot edit quotes or designs.',
    ],
];
