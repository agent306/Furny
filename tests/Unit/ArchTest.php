<?php

declare(strict_types=1);

arch('strict types')->expect('App')->toUseStrictTypes();

arch('no debug calls')->expect(['dd', 'dump', 'ray', 'var_dump'])->not->toBeUsed();

it('has the ten domain areas with the eight standard sub-directories', function (): void {
    $areas = ['Identity', 'Projects', 'Imports', 'Furniture', 'Catalog', 'Orders', 'Messaging', 'Ai', 'Settings', 'Shared'];
    $parts = ['Models', 'Actions', 'Data', 'Enums', 'Events', 'States', 'Jobs', 'Queries'];

    foreach ($areas as $area) {
        foreach ($parts as $part) {
            expect(base_path("app/Domain/{$area}/{$part}"))->toBeDirectory();
        }
    }
});
