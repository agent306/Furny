<?php

declare(strict_types=1);

/*
 * Part names (07 §1.6), mirrored in resources/js/engine/furniture/partNames.ts for exports.
 *
 * `n`, `leaf` and `piece` are optional: the client renders an absent argument as an empty string, so a bare
 * `{n}` leaves at most a trailing space ("Back panel "). `piece` numbers the pieces of a long panel that was
 * split at seams ("Top 2", "Fixed shelf 2 – piece 3"). ICU cannot test for an empty argument, so the
 * "– piece" suffix lists the piece numbers a panel can reach (at most 9) and shows nothing for any other value.
 */
$piece = '{piece, select, '
    .implode(' ', array_map(static fn (int $i): string => $i.' { – piece '.$i.'}', range(1, 9)))
    .' other {}}';

return [
    'side_left' => 'Left side',
    'side_right' => 'Right side',
    'top' => 'Top {piece}',
    'bottom' => 'Bottom {piece}',
    'back' => 'Back panel {n}',
    'partition' => 'Partition {n}',
    'fixed_shelf' => 'Fixed shelf {n}'.$piece,
    'shelf' => 'Shelf {n}',
    'plinth_front' => 'Plinth front {piece}',
    'plinth_back' => 'Plinth back {piece}',
    'plinth_return' => 'Plinth return {n}',
    'countertop' => 'Countertop {piece}',
    'door' => 'Door {leaf}',
    'flap' => 'Flap',
    'sliding_door' => 'Sliding door {leaf}',
    'glass_stile' => 'Door stile',
    'glass_rail' => 'Door rail',
    'glass_panel' => 'Glass panel',
    'drawer_front' => 'Drawer front {n}',
    'drawer_inner_front' => 'Drawer inner front {n}',
    'drawer_side' => 'Drawer side',
    'drawer_back' => 'Drawer back',
    'drawer_bottom' => 'Drawer bottom',
    'table_top' => 'Table top {piece}',
    'table_top_layer' => 'Table top layer {n}'.$piece,
    'table_leg' => 'Leg',
    'apron' => 'Apron {piece}',
    'stretcher' => 'Stretcher {piece}',
    'end_panel' => 'End panel',
    'modesty_panel' => 'Modesty panel {piece}',
    'lower_shelf' => 'Lower shelf {piece}',
    'trestle_upright' => 'Trestle upright',
    'trestle_foot' => 'Trestle foot',
    'trestle_cleat' => 'Trestle cleat',
    'pedestal_side' => 'Pedestal side',
    'pedestal_plate' => 'Pedestal plate',
    'drawer_runner' => 'Drawer runner',
    'extra' => '{name}',
];
