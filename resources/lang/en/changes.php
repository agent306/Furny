<?php

declare(strict_types=1);

// Change review messages of the furniture diff (07 §10.2).
return [
    'price_changed' => 'Estimated price {direction, select, up {increased} other {decreased}} by {deltaMinor} ({deltaPct}%)',
    'dims_changed' => '{dimension, select, width {Width} height {Height} depth {Depth} other {{dimension}}} changed from {beforeMm} to {afterMm} mm',
    'material_changed' => '{role}: {before} → {after}',
    'edge_band_changed' => '{role} edge banding: {before} → {after}',
    'finish_changed' => '{role} finish: {before} → {after}',
    // A length field passes beforeMm/afterMm, any other field before/after; the absent pair renders empty.
    'construction_changed' => '{field}: {before}{beforeMm} → {after}{afterMm}',
    'section_layout' => '{section}: layout changed',
    'section_size' => '{section}: sizes changed',
    'section_added' => 'Added {section}',
    'section_removed' => 'Removed {section}',
    'content_changed' => '{section}: {before} → {after}',
    'front_added' => 'Added {kind} over {sections}',
    'front_removed' => 'Removed {kind} over {sections}',
    'front_changed' => '{front}: {fields} changed',
    'part_added' => 'Added {name} ({lengthMm} × {widthMm})',
    'part_removed' => 'Removed {name}',
    'part_changed' => '{name}: {fields} changed',
    'parts_added_many' => '{count} parts added',
    'parts_removed_many' => '{count} parts removed',
    'parts_changed_many' => '{count} parts changed',
    'hardware_added' => 'Added {qty} × {name}',
    'hardware_removed' => 'Removed {qty} × {name}',
    'hardware_qty_changed' => '{name}: {before} → {after}',
    'notes_changed' => 'Notes updated',
];
