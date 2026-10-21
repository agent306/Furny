<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\MorphMap;
use Illuminate\Database\ClassMorphViolationException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;

it('maps every alias to an existing model class', function (): void {
    foreach (MorphMap::MAP as $alias => $class) {
        expect(class_exists($class))->toBeTrue("{$alias} => {$class} does not exist")
            ->and(is_subclass_of($class, Model::class))->toBeTrue("{$class} is not a model");
    }
});

it('lists every concrete model under app/Domain/*/Models (keeps later tasks honest)', function (): void {
    $models = [];

    foreach (glob(app_path('Domain/*/Models/*.php')) ?: [] as $file) {
        $class = 'App\\Domain\\'.str_replace('/', '\\', substr($file, strlen(app_path('Domain')) + 1, -4));
        $reflection = new ReflectionClass($class);

        if ($reflection->isInstantiable() && $reflection->isSubclassOf(Model::class)) {
            $models[] = $class;
        }
    }

    expect($models)->not->toBeEmpty();

    foreach ($models as $model) {
        expect(in_array($model, MorphMap::MAP, true))->toBeTrue("{$model} is missing from MorphMap::MAP");
    }
});

it('has unique aliases for unique classes', function (): void {
    expect(array_values(MorphMap::MAP))->toBe(array_values(array_unique(MorphMap::MAP)));
});

it('enforces the map so an unmapped morph class is refused', function (): void {
    expect((new User)->getMorphClass())->toBe('user')
        ->and(Relation::requiresMorphMap())->toBeTrue()
        ->and(Relation::morphMap())->toBe(MorphMap::MAP);

    (new class extends Model {})->getMorphClass();
})->throws(ClassMorphViolationException::class);

it('contains the Identity and infrastructure aliases', function (): void {
    expect(array_keys(MorphMap::MAP))->toContain(
        'user', 'address', 'staff_invitation', 'upload_intent', 'notification_delivery',
        'otp_code', 'notification_preference', 'app_setting', 'business_profile',
        'furniture_design', 'furniture_revision', 'furniture_preset', 'furniture_template_setting', 'blueprint_import',
    );
});
