<?php

declare(strict_types=1);

use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Every factory under `database/factories/Domain` can build a persisted row from nothing: its default
 * definition resolves every owner and parent itself, so a test can start from `Model::factory()->create()`.
 * The list comes from the directory, not from a hand-kept array, so a new factory is covered at once.
 *
 * @return array<string, array{class-string<Factory<Model>>}>
 */
function allFactoriesDiscovered(): array
{
    $root = dirname(__DIR__, 3).'/database/factories/Domain';
    $datasets = [];

    foreach (glob($root.'/*/*Factory.php') ?: [] as $file) {
        $relative = substr($file, strlen($root) + 1, -4);
        $datasets[$relative] = ['Database\\Factories\\Domain\\'.str_replace('/', '\\', $relative)];
    }

    ksort($datasets);

    return $datasets;
}

dataset('factories', fn (): array => allFactoriesDiscovered());

it('finds the factories of every domain area', function (): void {
    $names = array_keys(allFactoriesDiscovered());

    expect($names)->toContain('Identity/UserFactory', 'Orders/OrderFactory', 'Messaging/MessageFactory', 'Messaging/MessageReadFactory', 'Ai/AiCreditLedgerEntryFactory', 'Ai/AiUsageEventFactory');
});

it('creates a row from the factory alone', function (string $factory): void {
    expect(class_exists($factory))->toBeTrue("{$factory} is not autoloadable");

    $model = $factory::new()->create();

    expect($model)->toBeInstanceOf(Model::class)
        ->and($model)->toBeInstanceOf((new $factory)->modelName())
        ->and($model->exists)->toBeTrue()
        ->and($model::query()->withoutGlobalScopes()->count())->toBeGreaterThanOrEqual(1);
})->with('factories');

it('has a factory for every model that can use one', function (): void {
    $covered = array_map(
        static fn (array $dataset): string => (new ($dataset[0]))->modelName(),
        array_values(allFactoriesDiscovered()),
    );
    $missing = [];

    foreach (glob(dirname(__DIR__, 3).'/app/Domain/*/Models/*.php') ?: [] as $file) {
        $class = 'App\\Domain\\'.str_replace('/', '\\', substr($file, strlen(dirname(__DIR__, 3).'/app/Domain/'), -4));

        if (in_array(HasFactory::class, class_uses_recursive($class), true) && ! in_array($class, $covered, true)) {
            $missing[] = $class;
        }
    }

    expect($missing)->toBe([]);
});
