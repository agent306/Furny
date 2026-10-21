<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `hardware_items.category` (02 §6.3). */
#[TypeScript]
enum HardwareCategory: string
{
    case Hinge = 'hinge';
    case HingePlate = 'hinge_plate';
    case DrawerSlide = 'drawer_slide';
    case Handle = 'handle';
    case Knob = 'knob';
    case Leg = 'leg';
    case PlinthLeg = 'plinth_leg';
    case HangingRod = 'hanging_rod';
    case RodSupport = 'rod_support';
    case ShelfSupport = 'shelf_support';
    case Connector = 'connector';
    case Lock = 'lock';
    case LiftMechanism = 'lift_mechanism';
    case SlidingTrack = 'sliding_track';
    case SlidingRoller = 'sliding_roller';
    case GasStrut = 'gas_strut';
    case Damper = 'damper';
    case ScrewPack = 'screw_pack';
    case WallBracket = 'wall_bracket';
    case LedStrip = 'led_strip';
    case Other = 'other';
}
