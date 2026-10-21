<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    // Cloudflare Turnstile (13 §3). `features.captcha` is derived from both keys.
    'turnstile' => [
        'site_key' => env('TURNSTILE_SITE_KEY'),
        'secret_key' => env('TURNSTILE_SECRET_KEY'),
    ],

    // Google OAuth via Socialite (13 §5.3); hidden unless `features.google_login`.
    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT_URI') ?: rtrim((string) env('APP_URL', 'http://localhost'), '/').'/auth/google/callback',
    ],

    // WhatsApp channel (12 §7.2). The SMS drivers (Twilio, MSG91) are configured by the SMS task.
    'whatsapp' => [
        'driver' => env('WHATSAPP_DRIVER', 'meta'),
        'graph_version' => env('WHATSAPP_GRAPH_VERSION', 'v24.0'),
        'phone_number_id' => env('WHATSAPP_PHONE_NUMBER_ID'),
        'business_account_id' => env('WHATSAPP_BUSINESS_ACCOUNT_ID'),
        'access_token' => env('WHATSAPP_ACCESS_TOKEN'),
        'app_secret' => env('WHATSAPP_APP_SECRET'),
        'webhook_verify_token' => env('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
        'default_language' => env('WHATSAPP_DEFAULT_LANGUAGE', 'en'),
        'timeout' => (int) (env('WHATSAPP_TIMEOUT') ?: 10),
        'twilio_from' => env('TWILIO_WHATSAPP_FROM'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
