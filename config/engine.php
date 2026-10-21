<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Engine CLI (01 §5.4, 17 §5.11 item 8)
|--------------------------------------------------------------------------
*/

return [
    // docker/start.sh exports the absolute path in production.
    'node_binary' => env('ENGINE_NODE_BINARY') ?: 'node',
];
