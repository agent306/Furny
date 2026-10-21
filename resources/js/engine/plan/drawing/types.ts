/**
 * Plan drawing model types (04 §8.1): a renderer-agnostic list of draw items
 * shared by the live 2D renderer, the SVG/PNG/PDF exports and the DXF writer.
 */
import type { Vec2 } from '../../geometry/vec2';
import type { UnitPrefs } from '../../units/types';
import type { FootprintProvider } from '../footprint';

/** Paint order = the order of this list. */
export const LAYER_ORDER = [
    'BACKGROUND',
    'ROOMS',
    'FIXTURES',
    'FURNITURE',
    'WALLS',
    'OPENINGS',
    'DIMS',
    'TEXT',
] as const;
export type LayerName = (typeof LAYER_ORDER)[number];

export const STYLE_KEYS = [
    'wall',
    'wall_exterior',
    'wall_half',
    'wall_glass',
    'wall_outline',
    'opening_jamb',
    'door_leaf',
    'door_swing',
    'door_main_leaf',
    'sliding_panel',
    'window_frame',
    'window_glass',
    'threshold',
    'room_fill',
    'room_name',
    'room_area',
    'room_dims',
    'furniture',
    'furniture_front',
    'furniture_label',
    'furniture_missing',
    'fixture',
    'fixture_detail',
    'dim_line',
    'dim_tick',
    'dim_text',
    'dim_ext',
    'label',
] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

/**
 * Theme token key of a room fill (15 §3.4, `EditorColorKey`). The renderer
 * resolves it: CSS variable on screen, `EXPORT_PALETTE` in exports.
 */
export type RoomColorKey =
    | 'room-living'
    | 'room-bedroom'
    | 'room-kitchen'
    | 'room-bath'
    | 'room-outdoor'
    | 'room-utility'
    | 'room-study'
    | 'room-pooja'
    | 'room-circulation'
    | 'room-other';

export type DrawItem =
    | {
          t: 'poly';
          pts: Vec2[];
          holes?: Vec2[][];
          closed: boolean;
          style: StyleKey;
          /** Literal colour that overrides the style fill (fixture fills). */
          fill?: string;
          /**
           * Theme token overriding the style fill (room fills). Set on
           * `room_fill` items instead of a literal `fill`, so the fill follows
           * the UI theme on screen and the light palette in exports.
           */
          fillKey?: RoomColorKey;
          /** Dashed stroke; present (true) only when set. */
          dashed?: boolean;
      }
    | {
          t: 'line';
          a: Vec2;
          b: Vec2;
          style: StyleKey;
          /** Dashed stroke; present (true) only when set. */
          dashed?: boolean;
      }
    | {
          t: 'arc';
          c: Vec2;
          r: number;
          /** Plan-space degrees in `[0, 360)`; the sweep runs clockwise on screen. */
          startDeg: number;
          /** `startDeg` plus the sweep, so `endDeg - startDeg` is always the sweep (> 0). */
          endDeg: number;
          style: StyleKey;
      }
    | { t: 'circle'; c: Vec2; r: number; style: StyleKey }
    | {
          t: 'text';
          at: Vec2;
          text: string;
          sizeMm: number;
          /** Offset perpendicular to the text direction in multiples of the rendered size. */
          dyEm: number;
          rotationDeg: number;
          anchor: 'start' | 'middle' | 'end';
          baseline: 'middle' | 'top' | 'bottom';
          style: StyleKey;
      }
    | {
          /**
           * `at` is the plan coordinate of the unrotated image's top-left
           * pixel; `rotationDeg` turns the image about its centre
           * (`at + (width, height) / 2`), as 05 §4.12 and 06 §12.2 require.
           * `width` and `height` are the unrotated size in mm.
           */
          t: 'image';
          href: string;
          at: Vec2;
          width: number;
          height: number;
          rotationDeg: number;
          opacity: number;
      };

export interface DrawGroup {
    entityId: string | null;
    entityKind:
        | 'wall'
        | 'opening'
        | 'room'
        | 'placement'
        | 'fixture'
        | 'dimension'
        | 'auto_dimension'
        | 'label'
        | 'background';
    items: DrawItem[];
}

export interface PlanDrawing {
    /** Bounds of everything except the background image; `null` when nothing is drawn. */
    bbox: { min: Vec2; max: Vec2 } | null;
    layers: Record<LayerName, DrawGroup[]>;
}

export interface DrawingOptions {
    units: UnitPrefs;
    /** Already translated by the caller. */
    strings: { unnamedRoom: string; missingDesign: string };
    footprints: FootprintProvider;
    designName(designId: string): string | null;
    /** Screen: px / zoom; export: paper mm x scale denominator. */
    textSizeMm(style: StyleKey): number;
    include: {
        background: { href: string } | null;
        rooms: boolean;
        roomAreas: boolean;
        roomDims: boolean;
        furniture: boolean;
        fixtures: boolean;
        doorSwings: boolean;
        autoDimensions: boolean;
        userDimensions: boolean;
        labels: boolean;
    };
    /** 0 = full, 1 = medium, 2 = coarse (05 §4.7). */
    lod: 0 | 1 | 2;
}
