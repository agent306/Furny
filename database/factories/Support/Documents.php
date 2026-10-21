<?php

declare(strict_types=1);

namespace Database\Factories\Support;

use App\Support\Json\JsonDocument;
use InvalidArgumentException;
use stdClass;

/**
 * Document builders shared by the factories (16 §5.1). Records are `stdClass` so that they encode as
 * `{}` with {@see JsonDocument}. Furniture documents are structural placeholders until P5 switches
 * the factories to the P2 fixtures.
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

    /**
     * A structural `FurnitureDocument` (03 §2, `schemaVersion` 1): the carcass family with an empty
     * root section, 1800 x 2100 x 600 mm, and the starter-catalog codes of every material role.
     * It is shaped like a real document but is not generated from the template, so it must not be
     * fed to the engine's generator or price calculation.
     *
     * @return array<string, mixed>
     */
    public static function placeholderFurniture(string $templateKey = 'wardrobe'): array
    {
        $role = static fn (string $material, ?string $edgeBand = null): array => [
            'materialCode' => $material,
            'edgeBandCode' => $edgeBand,
            'finishCode' => null,
        ];

        return [
            'schemaVersion' => 1,
            'templateKey' => $templateKey,
            'family' => 'carcass',
            'dims' => ['width' => 1800, 'height' => 2100, 'depth' => 600],
            'materials' => [
                'carcass' => $role('PB18-WHITE', 'EB08-WHITE'),
                'back' => $role('HDF3-WHITE'),
                'shelf' => $role('PB18-WHITE', 'EB08-WHITE'),
                'front' => $role('PB18-WHITE', 'EB08-WHITE'),
                'top' => $role('PB18-WHITE', 'EB08-WHITE'),
                'drawer_box' => $role('PLY12-BWR'),
                'drawer_bottom' => $role('HDF3-WHITE'),
                'plinth' => $role('PB18-WHITE', 'EB08-WHITE'),
                'leg' => $role('SW50-RUBBER'),
            ],
            'carcass' => [
                'construction' => ['top' => 'between_sides', 'bottom' => 'between_sides'],
                'mounting' => 'floor',
                'plinth' => ['type' => 'none', 'height' => 0, 'setback' => 0, 'legCode' => null],
                'back' => ['type' => 'nailed'],
                'countertop' => null,
                'interior' => ['id' => 's_root', 'split' => 'none', 'children' => [], 'content' => ['type' => 'empty']],
                'fronts' => [],
                'handles' => ['code' => null, 'orientation' => 'auto', 'placement' => 'auto'],
            ],
            'table' => null,
            'overrides' => [
                'parts' => new stdClass,
                'extraParts' => [],
                'hardware' => new stdClass,
                'extraHardware' => [],
            ],
            'notes' => null,
        ];
    }
}
