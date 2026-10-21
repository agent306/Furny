<?php

declare(strict_types=1);

/**
 * Every variable of 17 §6.1 for furny-app. The nixpacks-only variables of the last row
 * (PHP_UPLOAD_MAX_FILESIZE, PHPRC, ...) are set in nixpacks.toml and deliberately absent:
 * an empty PHPRC loaded from .env would be inherited by child PHP processes.
 */
const ENV_EXAMPLE_VARIABLES = [
    'APP_NAME', 'APP_ENV', 'APP_KEY', 'APP_PREVIOUS_KEYS', 'APP_DEBUG', 'APP_URL', 'APP_LOCALE', 'APP_FALLBACK_LOCALE',
    'APP_FAKER_LOCALE', 'APP_MAINTENANCE_DRIVER', 'APP_MAINTENANCE_STORE', 'APP_VERSION', 'BCRYPT_ROUNDS',
    'CONTAINER_ROLE', 'RUN_MIGRATIONS', 'LOG_CHANNEL', 'LOG_STACK', 'LOG_LEVEL', 'LOG_DEPRECATIONS_CHANNEL',
    'DB_CONNECTION', 'DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD', 'REDIS_CLIENT', 'REDIS_HOST',
    'REDIS_PASSWORD', 'REDIS_PORT', 'REDIS_DB', 'REDIS_CACHE_DB', 'REDIS_SESSION_DB', 'REDIS_PREFIX', 'CACHE_STORE',
    'CACHE_PREFIX', 'QUEUE_CONNECTION', 'SESSION_DRIVER', 'SESSION_LIFETIME', 'SESSION_CONNECTION', 'SESSION_ENCRYPT',
    'SESSION_SECURE_COOKIE', 'SESSION_HTTP_ONLY', 'SESSION_EXPIRE_ON_CLOSE', 'SESSION_SAME_SITE', 'SESSION_DOMAIN',
    'SESSION_COOKIE', 'HORIZON_PREFIX', 'HORIZON_NOTIFY_EMAIL', 'BROADCAST_CONNECTION', 'REVERB_APP_ID', 'REVERB_APP_KEY',
    'REVERB_APP_SECRET', 'REVERB_HOST', 'REVERB_PORT', 'REVERB_SCHEME', 'REVERB_SERVER_HOST', 'REVERB_SERVER_PORT',
    'REVERB_SCALING_ENABLED', 'REVERB_SCALING_CHANNEL', 'REVERB_ALLOWED_ORIGINS', 'VITE_REVERB_APP_KEY', 'VITE_REVERB_HOST',
    'VITE_REVERB_PORT', 'VITE_REVERB_SCHEME', 'FILESYSTEM_DISK', 'MEDIA_DISK', 'MEDIA_QUEUE', 'QUEUE_CONVERSIONS_BY_DEFAULT',
    'IMAGE_DRIVER', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_REGION', 'AWS_BUCKET', 'AWS_URL',
    'AWS_ENDPOINT', 'AWS_USE_PATH_STYLE_ENDPOINT', 'AWS_PUBLIC_BUCKET', 'AWS_PUBLIC_URL', 'MAIL_MAILER', 'POSTMARK_TOKEN',
    'POSTMARK_MESSAGE_STREAM_ID', 'RESEND_KEY', 'MAIL_HOST', 'MAIL_PORT', 'MAIL_SCHEME', 'MAIL_USERNAME',
    'MAIL_PASSWORD', 'MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME', 'LARAVEL_PDF_DRIVER', 'GOTENBERG_URL', 'VISION_SERVICE_URL',
    'VISION_SERVICE_TOKEN', 'ENGINE_NODE_BINARY', 'WHATSAPP_DRIVER', 'WHATSAPP_GRAPH_VERSION', 'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'WHATSAPP_DEFAULT_LANGUAGE', 'WHATSAPP_TIMEOUT', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM',
    'TWILIO_SMS_SERVICE_SID', 'TWILIO_WHATSAPP_FROM', 'MSG91_AUTH_KEY', 'MSG91_SENDER_ID', 'MSG91_DLT_ENTITY_ID',
    'MSG91_BASE_URL', 'MSG91_WEBHOOK_TOKEN', 'VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'SEED_OWNER_NAME',
    'SEED_OWNER_EMAIL', 'SEED_OWNER_PASSWORD', 'FEATURE_PAYMENTS', 'FEATURE_WHATSAPP', 'FEATURE_SMS', 'FEATURE_WEB_PUSH',
    'FEATURE_GOOGLE_LOGIN', 'FEATURE_DXF_IMPORT', 'FEATURE_WALKTHROUGH_CAMERA', 'PULSE_ENABLED', 'PULSE_INGEST_DRIVER',
    'PULSE_DB_CONNECTION', 'PULSE_SERVER_NAME', 'PULSE_SLOW_QUERIES_THRESHOLD', 'PULSE_SLOW_REQUESTS_THRESHOLD',
    'PULSE_SLOW_JOBS_THRESHOLD', 'TELESCOPE_ENABLED', 'HEALTH_CHECK_TOKEN', 'TRUSTED_PROXIES', 'CSP_REPORT_ONLY',
    'SENTRY_LARAVEL_DSN', 'SENTRY_TRACES_SAMPLE_RATE', 'SENTRY_SEND_DEFAULT_PII', 'VITE_SENTRY_DSN', 'VITE_SENTRY_ENVIRONMENT',
    'OBJECT_BACKUP_ENABLED', 'OBJECT_BACKUP_SRC_PROVIDER', 'OBJECT_BACKUP_B2_KEY_ID', 'OBJECT_BACKUP_B2_APP_KEY',
    'OBJECT_BACKUP_B2_BUCKET', 'COMPOSER_NO_DEV',
];

/** @return array<string, string> */
function parseEnvExample(): array
{
    $variables = [];

    foreach (file(base_path('.env.example'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);

        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }

        [$name, $value] = explode('=', $line, 2) + [1 => ''];
        $variables[trim($name)] = trim(trim($value), '"');
    }

    return $variables;
}

it('lists every variable of 17 §6.1', function (): void {
    $missing = array_values(array_diff(ENV_EXAMPLE_VARIABLES, array_keys(parseEnvExample())));

    expect($missing)->toBe([]);
});

it('carries the documented local values', function (): void {
    $env = parseEnvExample();

    expect($env)->toMatchArray([
        'APP_NAME' => 'Furny',
        'APP_ENV' => 'local',
        'SESSION_DRIVER' => 'redis',
        'SESSION_CONNECTION' => 'sessions',
        'SESSION_ENCRYPT' => 'true',
        'SESSION_COOKIE' => 'furny_session',
        'REDIS_DB' => '0',
        'REDIS_CACHE_DB' => '1',
        'REDIS_SESSION_DB' => '2',
        'CACHE_STORE' => 'redis',
        'QUEUE_CONNECTION' => 'redis',
        'FEATURE_PAYMENTS' => 'false',
        'FEATURE_SMS' => 'true',
        'TURNSTILE_SITE_KEY' => '1x00000000000000000000AA',
        'TURNSTILE_SECRET_KEY' => '1x0000000000000000000000000000000AA',
    ]);
});

it('keeps secrets empty and the local vision token long enough', function (): void {
    $env = parseEnvExample();

    expect($env['APP_KEY'])->toBe('')
        ->and($env['VAPID_PRIVATE_KEY'])->toBe('')
        ->and($env['WHATSAPP_ACCESS_TOKEN'])->toBe('')
        ->and(strlen($env['VISION_SERVICE_TOKEN']))->toBeGreaterThanOrEqual(32);
});

it('has no APP_TIMEZONE variable because the timezone is fixed to UTC', function (): void {
    expect(parseEnvExample())->not->toHaveKey('APP_TIMEZONE');
});
