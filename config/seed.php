<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| First-deploy seed values (02 §14 item 5, 17 §6.1)
|--------------------------------------------------------------------------
|
| Read by OwnerSeeder through config() so that `config:cache` works; seeders never call env().
| Remove SEED_OWNER_* from the environment after the first deploy.
*/

return [
    'owner' => [
        'name' => env('SEED_OWNER_NAME', 'Owner'),
        'email' => env('SEED_OWNER_EMAIL'),
        'password' => env('SEED_OWNER_PASSWORD'),
    ],
];
