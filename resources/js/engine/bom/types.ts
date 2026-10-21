/**
 * Bill of materials types (03 §3.2, 08 §3). Plain TypeScript: the BOM is
 * computed, never parsed.
 */
import type { MaterialRole } from '../catalog/snapshot';
import type { EdgeId, PartKey } from '../furniture/schema';
import type { PartGrain } from '../furniture/types';
import type { Issue } from '../plan/types';

/** Options of `computeBom` (08 §3), built by `bomOptionsFor`. */
export interface ComputeBomOptions {
    nesting: boolean;
    /** Default: `catalog.pricing.nestingAllowRotationDefault`. */
    allowRotation?: boolean;
    /** From `doc.materials[role].finishCode`. */
    finishByRole: Record<MaterialRole, string | null>;
}

/** Identical parts merged into one cut list row (08 §3.4). */
export interface CutListRow {
    /** `r` + FNV-1a 32 of the row identity, 8 hex digits (+ `-k` on a collision). */
    rowKey: string;
    /** Sorted, each key once. */
    partKeys: PartKey[];
    /** English name for exports; the UI re-translates `nameKey` of the first part. */
    name: string;
    nameKey: string;
    nameParams: Record<string, string | number>;
    materialCode: string;
    thickness: number;
    /** Finished size. */
    length: number;
    width: number;
    /** Finished size − band thickness (+ pre-mill allowance), 08 §3.2. */
    cutLength: number;
    cutWidth: number;
    qty: number;
    grain: PartGrain;
    edges: Record<EdgeId, string | null>;
}

export interface NestingPlacement {
    rowKey: string;
    /** Instance key: `key` for the first instance, `key#k` for k ≥ 2. */
    partKey: PartKey;
    x: number;
    y: number;
    length: number;
    width: number;
    rotated: boolean;
}

export interface NestedSheet {
    materialCode: string;
    sheetLength: number;
    sheetWidth: number;
    placements: NestingPlacement[];
    utilization: number;
    /** Guillotine cut lines for drawing. */
    cuts: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

export interface NestingResult {
    sheets: NestedSheet[];
    kerf: number;
    trim: number;
    /** Instances larger than the sheet → issue `bom.part_exceeds_sheet`. */
    unplaced: PartKey[];
}

export interface BomMaterial {
    materialCode: string;
    partCount: number;
    /** Σ finished length × width × qty. */
    netAreaMm2: number;
    /** From nesting; null when nesting is off (or for glass). */
    sheetsNested: number | null;
    sheetsEstimated: number;
    /** `sheetsNested ?? sheetsEstimated`. */
    sheetsBilled: number;
    /** 0..1 from nesting, else null. */
    utilization: number | null;
}

export interface BomOperations {
    hingeCups: number;
    shelfPinHoles: number;
    dowels: number;
    camLocks: number;
    slideScrewSets: number;
    handleHoles: number;
}

export interface Bom {
    engineVersion: string;
    catalogVersion: number;
    cutList: CutListRow[];
    materials: BomMaterial[];
    /** Includes the 50 mm per-edge allowance and 5 % waste (08 §3.3). */
    edgeBanding: Array<{ edgeBandCode: string; lengthMm: number }>;
    /** Merged by code, after overrides. */
    hardware: Array<{ code: string; qty: number }>;
    finishing: Array<{ finishCode: string; areaMm2: number }>;
    operations: BomOperations;
    nesting: NestingResult | null;
    issues: Issue[];
}
