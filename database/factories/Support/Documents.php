<?php

declare(strict_types=1);

namespace Database\Factories\Support;

use App\Support\Json\JsonDocument;
use InvalidArgumentException;
use stdClass;

/**
 * Document builders shared by the factories (16 §5.1). Records are `stdClass` so that they encode as
 * `{}` with {@see JsonDocument}; later tasks add furniture documents here.
 */
final class Documents
{
    /**
     * The empty `PlanDocument` of 03 §1, `schemaVersion` 1.
     *
     * @param  array<string, mixed>  $metaOverrides  merged over the default `meta`
     * @return array<string, mixed>
     */
    public static function emptyPlan(array $metaOverrides = []): array
    {
        return [
            'schemaVersion' => 1,
            'meta' => array_merge([
                'defaultWallHeight' => 2700,
                'defaultWallThickness' => 115,
                'floorThickness' => 150,
                'northAngle' => null,
                'createdWith' => 'editor',
            ], $metaOverrides),
            'nodes' => new stdClass,
            'walls' => new stdClass,
            'openings' => new stdClass,
            'rooms' => new stdClass,
            'placements' => new stdClass,
            'fixtures' => new stdClass,
            'annotations' => [
                'dimensions' => new stdClass,
                'labels' => new stdClass,
            ],
            'background' => null,
            'view' => [
                'mode2d' => null,
                'mode3d' => null,
                'lastMode' => '2d',
            ],
        ];
    }

    /**
     * A committed plan document: `empty`, a plan fixture (`database/fixtures/plans`) or a plan starter
     * (`database/fixtures/plan-starters`).
     *
     * @return array<array-key, mixed>
     */
    public static function plan(string $name): array
    {
        if ($name === 'empty') {
            return self::emptyPlan();
        }

        foreach (['plans', 'plan-starters'] as $directory) {
            $path = database_path("fixtures/{$directory}/{$name}.json");

            if (is_file($path)) {
                return JsonDocument::decode((string) file_get_contents($path));
            }
        }

        throw new InvalidArgumentException("Unknown plan fixture [{$name}].");
    }
}
