<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Feature flags (master §6.7)
|--------------------------------------------------------------------------
|
| Raw switches only. Read flags through App\Support\Features, which also derives
| `captcha` and forces `web_push` off when the VAPID keys are missing.
*/

return [
    'payments' => filter_var(env('FEATURE_PAYMENTS', false), FILTER_VALIDATE_BOOLEAN),
    'whatsapp' => filter_var(env('FEATURE_WHATSAPP', false), FILTER_VALIDATE_BOOLEAN),
    'sms' => filter_var(env('FEATURE_SMS', false), FILTER_VALIDATE_BOOLEAN),
    'web_push' => filter_var(env('FEATURE_WEB_PUSH', true), FILTER_VALIDATE_BOOLEAN),
    'google_login' => filter_var(env('FEATURE_GOOGLE_LOGIN', false), FILTER_VALIDATE_BOOLEAN),
    'dxf_import' => filter_var(env('FEATURE_DXF_IMPORT', true), FILTER_VALIDATE_BOOLEAN),
    'walkthrough_camera' => filter_var(env('FEATURE_WALKTHROUGH_CAMERA', true), FILTER_VALIDATE_BOOLEAN),
];
