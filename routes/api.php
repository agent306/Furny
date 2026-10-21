<?php

declare(strict_types=1);

// The editor's JSON endpoints (14 §4). Registered by bootstrap/app.php under the `/api` prefix and the `api.`
// name prefix, with the middleware `web`, `auth`, `active` and `throttle:api`: session authentication, CSRF
// protection, and bare JSON errors (the `api/*` paths are machine paths, 13 §12). Empty until the editor tasks.
