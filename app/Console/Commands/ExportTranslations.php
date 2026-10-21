<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use MessageFormatter;

/**
 * Exports the ICU namespaces of resources/lang to resources/js/lang/generated (15 §15.3).
 *
 * Every message is validated before anything is written, so a failing run leaves the committed
 * output untouched.
 */
final class ExportTranslations extends Command
{
    /** Laravel-format namespaces (`:param` placeholders) are rendered by Laravel only, never exported. */
    private const array LARAVEL_NAMESPACES = ['auth', 'pagination', 'passwords', 'validation'];

    protected $signature = 'i18n:export';

    protected $description = 'Export the ICU translations to resources/js/lang/generated and write the manifest';

    public function handle(): int
    {
        /** @var list<string> $locales */
        $locales = config('app.supported_locales');
        $errors = [];
        $exports = [];

        foreach ($locales as $locale) {
            $exports[$locale] = $this->collect($locale, $errors);
        }

        if ($errors !== []) {
            foreach ($errors as $error) {
                $this->error($error);
            }

            $this->error('Translations were not exported: '.count($errors).' invalid '.(count($errors) === 1 ? 'message' : 'messages').'.');

            return self::FAILURE;
        }

        $directory = resource_path('js/lang/generated');
        File::ensureDirectoryExists($directory);

        $manifest = [];

        foreach ($exports as $locale => $messages) {
            $json = $this->encode($messages);
            File::put("{$directory}/{$locale}.json", $json);
            $manifest[$locale] = sha1($json);
        }

        File::put("{$directory}/manifest.json", $this->encode($manifest));

        $this->info('Exported '.count($locales).' locale(s) to resources/js/lang/generated.');

        return self::SUCCESS;
    }

    /**
     * @param  list<string>  $errors
     * @return array<string, string>
     */
    private function collect(string $locale, array &$errors): array
    {
        $directory = lang_path($locale);

        if (! is_dir($directory)) {
            $errors[] = "{$locale}: translation directory resources/lang/{$locale} does not exist.";

            return [];
        }

        $messages = [];
        $files = glob("{$directory}/*.php") ?: [];
        sort($files);

        foreach ($files as $file) {
            $namespace = basename($file, '.php');

            if (in_array($namespace, self::LARAVEL_NAMESPACES, true)) {
                continue;
            }

            $contents = require $file;

            if (! is_array($contents)) {
                $errors[] = "{$locale}: resources/lang/{$locale}/{$namespace}.php must return an array.";

                continue;
            }

            foreach ($this->flatten($contents, $namespace) as $key => $value) {
                if (! is_string($value)) {
                    $errors[] = "{$locale}: {$key} must be a string.";

                    continue;
                }

                // create() returns null for an invalid pattern; the intl stubs do not say so.
                // @phpstan-ignore identical.alwaysFalse
                if (MessageFormatter::create($locale, $value) === null) {
                    $errors[] = "{$locale}: {$key} is not a valid ICU message (".intl_get_error_message().').';

                    continue;
                }

                $messages[$key] = $value;
            }
        }

        ksort($messages, SORT_STRING);

        return $messages;
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return array<string, mixed>
     */
    private function flatten(array $values, string $prefix): array
    {
        $flat = [];

        foreach ($values as $segment => $value) {
            $key = "{$prefix}.{$segment}";

            if (is_array($value)) {
                $flat += $this->flatten($value, $key);
            } else {
                $flat[$key] = $value;
            }
        }

        return $flat;
    }

    /** @param  array<string, string>  $data */
    private function encode(array $data): string
    {
        return json_encode(
            $data === [] ? (object) [] : $data,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
        )."\n";
    }
}
