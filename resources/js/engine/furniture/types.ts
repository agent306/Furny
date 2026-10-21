/**
 * Derived furniture model types (03 §3.1) and the part-builder inputs
 * (07 §1.2). Plain TypeScript: the model is computed, never parsed.
 */
import type { CatalogMaterial, MaterialRole } from '../catalog/snapshot';
import type { Issue } from '../plan/types';
import type { CatalogIndex } from './catalogIndex';
import type { EdgeId, FurnitureDocument, HardwareKey, PartKey } from './schema';
import type { FurnitureIssueCode } from './validate';

/** Millimetre box in furniture local space (07 §1.1). */
export interface Box3 {
    min: [number, number, number];
    size: [number, number, number];
}

export type Axis = 'x' | 'y' | 'z';
export type PhysEdge = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';

export type PartGrain = 'length' | 'width' | 'none';

export interface PartOperations {
    hingeCups: number;
    shelfPinHoles: number;
    slideScrewSets: number;
    handleHoles: number;
    dowels: number;
    camLocks: number;
}

export type PartGeometry =
    | { kind: 'box'; box: Box3 }
    | {
          kind: 'extruded';
          outline: Array<[number, number]>;
          plane: 'xz';
          y: number;
          thickness: number;
      };

export interface Part {
    key: PartKey;
    /** i18n key, e.g. `parts.side_left`. */
    nameKey: string;
    nameParams: Record<string, string | number>;
    role: MaterialRole;
    materialCode: string;
    /** Rounded from the material `thicknessMm`. */
    thickness: number;
    /** Finished size along the part's length axis (at least `width`). */
    length: number;
    width: number;
    /** Which finished dimension must follow the sheet grain. */
    grain: PartGrain;
    /** Edge band codes. */
    edges: Record<EdgeId, string | null>;
    /** Identical parts are not merged here (merging happens in the BOM). */
    qty: number;
    geometry: PartGeometry;
    operations: PartOperations;
    /** 0, 1 or 2; used for the finish area. */
    visibleFaces: number;
    source: 'generated' | 'extra';
    overridden: boolean;
}

export interface HardwareLine {
    key: HardwareKey;
    /** `hardware_items.code`. */
    code: string;
    qty: number;
    /** i18n key, e.g. `hardware.reason.hinges_for_door`. */
    reasonKey: string;
    reasonParams: Record<string, string | number>;
    frontId: string | null;
    sectionId: string | null;
    source: 'generated' | 'extra';
    overridden: boolean;
}

/** A front for the 2D elevation and 3D animation. */
export interface ModelFront {
    id: string;
    frontId: string | null;
    kind: 'door' | 'drawer' | 'flap' | 'sliding';
    rect: { x: number; y: number; w: number; h: number };
    hingeSide?: 'left' | 'right';
    partKey: PartKey;
}

export interface FurnitureModel {
    parts: Part[];
    hardware: HardwareLine[];
    fronts: ModelFront[];
    /** Interior box per leaf section (UI picking and dimensioning). */
    sections: Array<{ id: string; box: Box3 }>;
    bbox: Box3;
    issues: Issue[];
}

/** Everything `makePart` needs to place and describe one panel (07 §1.2). */
export interface PanelSpec {
    key: PartKey;
    nameKey: string;
    nameParams?: Record<string, string | number>;
    role: MaterialRole;
    /** Resolved from `doc.materials[role]` unless stated otherwise. */
    materialCode: string;
    /** Exact placement in local space (fractional allowed). */
    box: Box3;
    /** The axis along which the panel is thin. */
    thicknessAxis: Axis;
    /** Intended grain direction (null = no preference). */
    grainAxis: Axis | null;
    /** Physical edges that receive the role edge band (07 §5). */
    banded: PhysEdge[];
    /** Overrides the role band; used for drawer boxes. */
    bandCode?: string | null;
    visibleFaces: 0 | 1 | 2;
    operations?: Partial<PartOperations>;
    /** Default: `{ kind: 'box', box }`. */
    geometry?: PartGeometry;
}

/** A glued/cammed joint recorded for connector rules (07 §6.9). */
export interface Joint {
    member: PartKey;
    other: PartKey;
    length: number;
}

/** Mutable state shared by the generation pipeline (07 §3.1). */
export interface GenContext {
    doc: FurnitureDocument;
    idx: CatalogIndex;
    parts: Part[];
    hardware: HardwareLine[];
    fronts: ModelFront[];
    sections: Array<{ id: string; box: Box3 }>;
    issues: Issue[];
    /** Physical meaning of each `EdgeId` per part (edge picker, banding). */
    edgeMap: Map<PartKey, Record<EdgeId, PhysEdge>>;
    joints: Joint[];
    /**
     * Effective material of a role: the assigned one, or the role default when
     * the code is unknown (the document is then reported, not rejected).
     */
    mat(role: MaterialRole): CatalogMaterial;
    /** `Math.round(thicknessMm)` of the effective material (`t_*` of 07). */
    t(role: MaterialRole): number;
    /** `doc.materials[role].edgeBandCode ?? material(role).defaultEdgeBandCode ?? null` (07 §5.1). */
    roleBand(role: MaterialRole): string | null;
    /** Records an issue (the `messageKey` is derived from `code`) and returns it. */
    issue(
        code: FurnitureIssueCode,
        severity: Issue['severity'],
        params?: Issue['params'],
        entityIds?: string[],
    ): Issue;
    addHardware(line: HardwareLine): void;
}
