<?php

declare(strict_types=1);

/** @return array<string, string> */
$exported = fn (): array => json_decode(
    (string) file_get_contents(base_path('resources/js/lang/generated/en.json')),
    true,
    flags: JSON_THROW_ON_ERROR,
);

afterEach(function (): void {
    @unlink(lang_path('en/zz_test.php'));
});

it('exports the ICU messages as flat dot keys', function () use ($exported): void {
    $this->artisan('i18n:export')->assertSuccessful();

    expect($exported())->toHaveKey('common.photo_n', 'Photo {n}')
        ->toHaveKey('common.counts.items', '{count, plural, one {# item} other {# items}}');
});

it('sorts the keys', function () use ($exported): void {
    $this->artisan('i18n:export')->assertSuccessful();

    $keys = array_keys($exported());
    $sorted = $keys;
    sort($sorted, SORT_STRING);

    expect($keys)->toBe($sorted);
});

it('leaves the Laravel-format namespaces out', function () use ($exported): void {
    $this->artisan('i18n:export')->assertSuccessful();

    foreach (array_keys($exported()) as $key) {
        expect($key)->not->toStartWith('validation.')
            ->not->toStartWith('passwords.')
            ->not->toStartWith('pagination.')
            ->not->toStartWith('auth.');
    }
});

it('writes a manifest with the sha1 of each exported file', function (): void {
    $this->artisan('i18n:export')->assertSuccessful();

    $manifest = json_decode(
        (string) file_get_contents(base_path('resources/js/lang/generated/manifest.json')),
        true,
        flags: JSON_THROW_ON_ERROR,
    );

    expect($manifest)->toBe(['en' => sha1_file(base_path('resources/js/lang/generated/en.json'))]);
});

it('fails naming the key of a message that is not valid ICU', function (): void {
    file_put_contents(lang_path('en/zz_test.php'), "<?php\n\nreturn ['bad' => '{count, plural, one {#}'];\n");

    $this->artisan('i18n:export')
        ->expectsOutputToContain('zz_test.bad')
        ->assertFailed();
});

it('rejects non-ICU shorthands such as {n?}', function (): void {
    file_put_contents(lang_path('en/zz_test.php'), "<?php\n\nreturn ['shorthand' => 'Photo {n?}'];\n");

    $this->artisan('i18n:export')
        ->expectsOutputToContain('zz_test.shorthand')
        ->assertFailed();
});

it('does not touch the generated files when validation fails', function (): void {
    $this->artisan('i18n:export')->assertSuccessful();
    $before = sha1_file(base_path('resources/js/lang/generated/en.json'));

    file_put_contents(lang_path('en/zz_test.php'), "<?php\n\nreturn ['bad' => '{count, plural, one {#}', 'good' => 'Fine'];\n");
    $this->artisan('i18n:export')->assertFailed();

    expect(sha1_file(base_path('resources/js/lang/generated/en.json')))->toBe($before);
});
