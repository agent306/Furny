<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureTemplateSetting;
use App\Domain\Messaging\Models\MessageRead;
use App\Domain\Settings\Models\AppSetting;
use App\Domain\Settings\Models\BusinessProfile;
use Illuminate\Database\Eloquent\Concerns\HasUlids;

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

/**
 * @return list<class-string>
 */
function archDomainClasses(string $directory): array
{
    $root = dirname(__DIR__, 2).'/app/Domain/';
    $classes = [];

    foreach (glob($root."*/{$directory}/*.php") ?: [] as $file) {
        /** @var class-string $class */
        $class = 'App\\Domain\\'.str_replace('/', '\\', substr($file, strlen($root), -4));
        $classes[] = $class;
    }

    return $classes;
}

it('makes every domain model final and gives it a ULID key', function (): void {
    // Models whose key is not a generated ULID: settings are keyed by name, the business profile is a singleton
    // pseudo-model, template settings by their template key and a message read mark by (order, user).
    $withoutUlid = [AppSetting::class, BusinessProfile::class, FurnitureTemplateSetting::class, MessageRead::class];
    $models = archDomainClasses('Models');

    $notFinal = array_values(array_filter($models, static fn (string $model): bool => ! (new ReflectionClass($model))->isFinal()));
    $withoutKey = array_values(array_filter(
        $models,
        static fn (string $model): bool => ! in_array($model, $withoutUlid, true) && ! in_array(HasUlids::class, class_uses_recursive($model), true),
    ));

    expect($notFinal)->toBe([])
        ->and($withoutKey)->toBe([]);

    // The exceptions stay real: a renamed or removed model must not leave a stale entry that hides a new one.
    expect($models)->toContain(...$withoutUlid);
});

it('makes every domain action final', function (): void {
    $open = array_values(array_filter(
        archDomainClasses('Actions'),
        static fn (string $action): bool => ! (new ReflectionClass($action))->isFinal(),
    ));

    expect($open)->toBe([]);
});
