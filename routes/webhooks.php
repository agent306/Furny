<?php

declare(strict_types=1);

// Inbound webhooks (13 §14, 17 §5.11). Registered by bootstrap/app.php under the `/webhooks` prefix and the
// `webhooks.` name prefix, stateless (no `web` group: no session, no cookie, no CSRF token) with
// `throttle:webhooks`. Each route verifies its own signature or token. Empty until the notification tasks (P8).
