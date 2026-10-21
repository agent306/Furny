<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Log;

if (! function_exists('trans_icu')) {
    /**
     * Renders an ICU MessageFormat message from resources/lang (15 §15.3).
     *
     * A missing key (or a key that names a group of messages) returns the key and logs a warning;
     * a message that cannot be formatted with the given parameters does the same.
     *
     * @param  array<string|int, mixed>  $params
     */
    function trans_icu(string $key, array $params = [], ?string $locale = null): string
    {
        $locale ??= app()->getLocale();
        $message = trans($key, [], $locale);

        if (! is_string($message) || $message === $key) {
            Log::warning('Missing ICU translation.', ['key' => $key, 'locale' => $locale]);

            return $key;
        }

        $formatted = MessageFormatter::formatMessage($locale, $message, $params);

        if ($formatted === false) {
            Log::warning('ICU translation could not be formatted.', [
                'key' => $key,
                'locale' => $locale,
                'error' => intl_get_error_message(),
            ]);

            return $key;
        }

        return $formatted;
    }
}
