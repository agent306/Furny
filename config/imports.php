<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Blueprint import limits and vision service (06 §4.1)
|--------------------------------------------------------------------------
*/

return [
    'max_bytes' => [
        'raster' => 25 * 1024 * 1024,
        'pdf' => 25 * 1024 * 1024,
        'heic' => 25 * 1024 * 1024,
        'dxf' => 15 * 1024 * 1024,
    ],
    'max_pdf_pages' => 20,
    'max_active_per_user' => 2,
    // Server-side presigns for the vision service only (06 §4.7); browser uploads use 13 §11.
    'vision_presign_ttl_minutes' => 15,
    'vision' => [
        'url' => env('VISION_SERVICE_URL', 'http://furny-vision:8000'),
        'token' => env('VISION_SERVICE_TOKEN'),
        'recognize_timeout_s' => 600,
        'inspect_timeout_s' => 30,
        'normalize_timeout_s' => 120,
        'connect_timeout_s' => 5,
        'debug_outputs' => 8,
    ],
    'retention' => [
        'discard_ready_after_days' => 60,
        'purge_media_after_days' => 30,
    ],
];
