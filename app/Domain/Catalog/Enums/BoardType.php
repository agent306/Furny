<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `materials.board_type` (02 §6.1). */
#[TypeScript]
enum BoardType: string
{
    case ParticleBoard = 'particle_board';
    case Mdf = 'mdf';
    case Hdf = 'hdf';
    case Plywood = 'plywood';
    case Blockboard = 'blockboard';
    case SolidWood = 'solid_wood';
    case Glass = 'glass';
    case Acrylic = 'acrylic';
    case MetalSheet = 'metal_sheet';
}
