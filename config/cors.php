<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| CORS (13 §12.5)
|--------------------------------------------------------------------------
|
| The application serves no cross-origin API, so no path is CORS-enabled.
| Object-storage CORS is configured on the buckets (17 §7.4).
*/

return [
    'paths' => [],
    'allowed_methods' => ['*'],
    'allowed_origins' => [],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
