<?php

declare(strict_types=1);

use App\Support\Json\JsonDocument;

it('round-trips empty objects, empty lists and whole-number floats byte for byte', function (): void {
    $json = '{"nodes":{},"walls":{},"angle":90.0,"list":[],"n":{"a":{}}}';

    expect(JsonDocument::encode(JsonDocument::decode($json)))->toBe($json);
});

it('decodes objects with members to arrays and empty objects to stdClass', function (): void {
    $doc = JsonDocument::decode('{"nodes":{},"walls":{"w_1":{"a":"n_1","tags":[{"x":1},{}]}},"list":[]}');

    expect($doc['nodes'])->toBeInstanceOf(stdClass::class)
        ->and($doc['walls'])->toBeArray()
        ->and($doc['walls']['w_1']['a'])->toBe('n_1')
        ->and($doc['walls']['w_1']['tags'][0])->toBe(['x' => 1])
        ->and($doc['walls']['w_1']['tags'][1])->toBeInstanceOf(stdClass::class)
        ->and($doc['list'])->toBe([]);
});

it('keeps unicode and slashes unescaped and integers as integers', function (): void {
    $json = '{"name":"Küche / Bad ₹","width":4000,"ratio":0.5,"flag":false,"none":null}';

    expect(JsonDocument::encode(JsonDocument::decode($json)))->toBe($json);
});

it('throws a JsonException for invalid JSON on decode', function (): void {
    JsonDocument::decode('{"nodes":');
})->throws(JsonException::class);

it('throws a JsonException when a document cannot be encoded', function (): void {
    JsonDocument::encode(['bad' => NAN]);
})->throws(JsonException::class);
