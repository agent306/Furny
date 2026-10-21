<?php

declare(strict_types=1);

// Furniture templates (07 §2): names and descriptions, parameter labels (`fields`), help, select options and ranges.
return [
    'wardrobe_hinged' => [
        'name' => 'Wardrobe',
        'description' => 'Floor-standing wardrobe with hinged doors, shelf columns and hanging space.',
    ],
    'wardrobe_sliding' => [
        'name' => 'Sliding wardrobe',
        'description' => 'Wardrobe with sliding doors that save floor space.',
    ],
    'loft_cabinet' => [
        'name' => 'Loft cabinet',
        'description' => 'Storage above a wardrobe or a door, closed with hinged doors or flaps.',
    ],
    'base_cabinet' => [
        'name' => 'Base cabinet',
        'description' => 'Kitchen base unit with a door, drawers or pull-out baskets.',
    ],
    'wall_cabinet' => [
        'name' => 'Wall cabinet',
        'description' => 'Kitchen unit hung on the wall.',
    ],
    'tall_cabinet' => [
        'name' => 'Tall cabinet',
        'description' => 'Full-height kitchen or utility cabinet, optionally with an appliance niche.',
    ],
    'bookshelf' => [
        'name' => 'Bookshelf',
        'description' => 'Free-standing shelves with evenly spaced boards.',
    ],
    'open_shelf_wall' => [
        'name' => 'Wall shelf',
        'description' => 'Open shelves fixed to the wall.',
    ],
    'tv_unit' => [
        'name' => 'TV unit',
        'description' => 'Low unit with drawers, open space and doors for a TV.',
    ],
    'shoe_rack' => [
        'name' => 'Shoe rack',
        'description' => 'Slim shelves for shoes by the entrance.',
    ],
    'chest_of_drawers' => [
        'name' => 'Chest of drawers',
        'description' => 'Bedroom chest with rows of drawers.',
    ],
    'sideboard' => [
        'name' => 'Sideboard',
        'description' => 'Low storage cabinet for the dining or living room.',
    ],
    'bedside_table' => [
        'name' => 'Bedside table',
        'description' => 'Small table beside the bed with a drawer or a door.',
    ],
    'study_desk' => [
        'name' => 'Study desk',
        'description' => 'Desk with storage cabinets, side panels or legs.',
    ],
    'dining_table' => [
        'name' => 'Dining table',
        'description' => 'Dining table in a rectangular, round or oval shape.',
    ],
    'coffee_table' => [
        'name' => 'Coffee table',
        'description' => 'Low living room table with an optional lower shelf.',
    ],
    'console_table' => [
        'name' => 'Console table',
        'description' => 'Narrow table for a hallway or behind a sofa, with optional drawers.',
    ],
    'dressing_unit' => [
        'name' => 'Dressing unit',
        'description' => 'Tall unit with rows of drawers for clothes.',
    ],
    'custom_box' => [
        'name' => 'Custom box',
        'description' => 'A plain box in any size to start your own design.',
    ],

    // `templates.range`: helper text under a length field.
    'range' => 'Between {min} and {max}',

    'fields' => [
        'applianceNiche' => 'Appliance niche',
        'backType' => 'Back panel',
        'base' => 'Base',
        'cabinetContent' => 'Cabinet contents',
        'cabinetWidth' => 'Cabinet width',
        'columns' => 'Columns',
        'countertop' => 'Countertop',
        'depth' => 'Depth',
        'doors' => 'Doors',
        'drawerCount' => 'Number of drawers',
        'drawerRows' => 'Rows of drawers',
        'drawers' => 'Drawers',
        'frontKind' => 'Front type',
        'hangingStyle' => 'Hanging style',
        'height' => 'Height',
        'internalDrawers' => 'Internal drawers',
        'layout' => 'Layout',
        'leaves' => 'Door leaves',
        'legHeight' => 'Leg height',
        'legSource' => 'Leg material',
        'lowerDoors' => 'Doors on the lower part',
        'lowerShelf' => 'Lower shelf',
        'mounting' => 'Mounting',
        'plinthHeight' => 'Plinth height',
        'rows' => 'Rows',
        'shape' => 'Top shape',
        'singleColumnSide' => 'Single-door column side',
        'slideType' => 'Drawer slides',
        'topDrawer' => 'Drawer under the top',
        'variant' => 'Style',
        'width' => 'Width',
    ],

    'help' => [
        'hanging_depth' => 'A depth of at least 580 mm is recommended so clothes on hangers fit.',
    ],

    // Shared by every template that offers the value.
    'options' => [
        '1' => '1',
        '2' => '2',
        'auto' => 'Automatic',
        'basket' => 'Pull-out baskets',
        'cabinet_ends' => 'Cabinets at the ends',
        'door' => 'Door',
        'door_drawer' => 'Door and drawer',
        'doors_open_doors' => 'Doors, open space, doors',
        'double' => 'Double hanging',
        'drawer_door' => 'Drawer and door',
        'drawer_open' => 'Drawer and open shelf',
        'drawers' => 'Drawers',
        'drawers_open_door' => 'Drawers, open space, door',
        'flap_up' => 'Flap that opens upwards',
        'flaps' => 'Flaps',
        'floor' => 'Floor standing',
        'four_legs' => 'Four legs',
        'grooved' => 'Grooved into the sides',
        'hardware' => 'Metal legs',
        'hinged' => 'Hinged doors',
        'inset' => 'Inset',
        'left' => 'Left',
        'loft' => 'Loft',
        'long' => 'Long hanging',
        'nailed' => 'Nailed on',
        'none' => 'None',
        'open' => 'Open (no doors)',
        'oval' => 'Oval',
        'panel_ends' => 'Panel ends',
        'pedestal' => 'Pedestal',
        'rectangle' => 'Rectangle',
        'right' => 'Right',
        'round' => 'Round',
        'rounded_rectangle' => 'Rounded rectangle',
        'shelves' => 'Shelves',
        'side_mount' => 'Side-mounted',
        'solid' => 'Solid legs',
        'trestle' => 'Trestle',
        'two_drawers' => 'Two drawers',
        'undermount' => 'Under-mounted',
        'wall' => 'Wall mounted',
    ],
];
