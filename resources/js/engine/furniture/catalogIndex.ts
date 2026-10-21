/**
 * Catalog index and role defaults (07 §1.5): O(1) lookups by code, role
 * defaults and hardware families over a `CatalogSnapshot`. Lookups by code
 * include inactive (archived) rows so old documents keep resolving; defaults
 * and families only ever pick active rows.
 *
 * A missing default is `undefined`, never an error: the generator omits the
 * hardware line and warns `furniture.no_default_hardware` (07 §1.5).
 */
import { cmpId } from '../compare';
import type {
    CatalogEdgeBand,
    CatalogFinish,
    CatalogHardware,
    CatalogLabourRate,
    CatalogMaterial,
    CatalogSnapshot,
    MaterialRole,
} from '../catalog/snapshot';
import type { HardwareRoleKey } from '../catalog/specs';
import { DEFAULT_DENSITY } from './rules/weight';

export interface CatalogIndex {
    snapshot: CatalogSnapshot;
    /** Includes inactive (archived) rows. */
    material(code: string): CatalogMaterial | undefined;
    edgeBand(code: string): CatalogEdgeBand | undefined;
    hardware(code: string): CatalogHardware | undefined;
    finish(code: string): CatalogFinish | undefined;
    labour(key: string): CatalogLabourRate | undefined;
    /** First ACTIVE item (sortOrder asc, code asc) whose `isDefaultFor` contains `roleKey`. */
    defaultHardware(roleKey: HardwareRoleKey): CatalogHardware | undefined;
    /** ACTIVE items of `category` with `specs.family = family`, by `specs.lengthMm` asc, then code. */
    hardwareFamily(category: string, family: string): CatalogHardware[];
    /** First active material whose usage has `role`, else the first with `carcass`, else the first active (07 §2.3). */
    defaultMaterialFor(role: MaterialRole): CatalogMaterial | undefined;
    /** First ACTIVE material with `boardType 'glass'` (sortOrder, code). */
    glassMaterial(): CatalogMaterial | undefined;
    /** `densityKgM3` when set, else the board-type default (07 §6.1). */
    densityOf(m: CatalogMaterial): number;
}

const byOrderThenCode = (
    a: { sortOrder: number; code: string },
    b: { sortOrder: number; code: string },
): number => a.sortOrder - b.sortOrder || cmpId(a.code, b.code);

/** Keeps the first row seen per key, so a duplicated code resolves deterministically. */
function mapBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T> {
    const map = new Map<string, T>();
    for (const row of rows) {
        const k = key(row);
        if (!map.has(k)) map.set(k, row);
    }
    return map;
}

const lengthOf = (h: CatalogHardware): number =>
    typeof h.specs.lengthMm === 'number' ? h.specs.lengthMm : Infinity;

const familyKey = (category: string, family: string): string =>
    `${category}\u0000${family}`;

function buildIndex(snapshot: CatalogSnapshot): CatalogIndex {
    const materials = mapBy(snapshot.materials, (m) => m.code);
    const edgeBands = mapBy(snapshot.edgeBands, (e) => e.code);
    const hardware = mapBy(snapshot.hardware, (h) => h.code);
    const finishes = mapBy(snapshot.finishes, (f) => f.code);
    const labour = mapBy(snapshot.labourRates, (l) => l.key);

    const activeMaterials = snapshot.materials
        .filter((m) => m.isActive)
        .sort(byOrderThenCode);
    const activeHardware = snapshot.hardware
        .filter((h) => h.isActive)
        .sort(byOrderThenCode);

    const roleDefaults = new Map<string, CatalogHardware>();
    const families = new Map<string, CatalogHardware[]>();
    for (const h of activeHardware) {
        for (const key of h.isDefaultFor) {
            if (!roleDefaults.has(key)) roleDefaults.set(key, h);
        }
        const family = h.specs.family;
        if (typeof family === 'string') {
            const k = familyKey(h.category, family);
            const list = families.get(k);
            if (list) list.push(h);
            else families.set(k, [h]);
        }
    }
    for (const list of families.values()) {
        list.sort((a, b) => lengthOf(a) - lengthOf(b) || cmpId(a.code, b.code));
    }

    const firstWithUsage = (usage: string): CatalogMaterial | undefined =>
        activeMaterials.find((m) => m.usage.includes(usage));
    const glass = activeMaterials.find((m) => m.boardType === 'glass');
    const materialDefaults = new Map<
        MaterialRole,
        CatalogMaterial | undefined
    >();

    return {
        snapshot,
        material: (code) => materials.get(code),
        edgeBand: (code) => edgeBands.get(code),
        hardware: (code) => hardware.get(code),
        finish: (code) => finishes.get(code),
        labour: (key) => labour.get(key),
        defaultHardware: (roleKey) => roleDefaults.get(roleKey),
        hardwareFamily: (category, family) => [
            ...(families.get(familyKey(category, family)) ?? []),
        ],
        defaultMaterialFor(role) {
            if (!materialDefaults.has(role)) {
                materialDefaults.set(
                    role,
                    firstWithUsage(role) ??
                        firstWithUsage('carcass') ??
                        activeMaterials[0],
                );
            }
            return materialDefaults.get(role);
        },
        glassMaterial: () => glass,
        densityOf: (m) => m.densityKgM3 ?? DEFAULT_DENSITY[m.boardType],
    };
}

const cache = new WeakMap<CatalogSnapshot, CatalogIndex>();

/** Memoised per snapshot object; treat the snapshot as immutable once indexed. */
export function indexCatalog(snapshot: CatalogSnapshot): CatalogIndex {
    let index = cache.get(snapshot);
    if (!index) {
        index = buildIndex(snapshot);
        cache.set(snapshot, index);
    }
    return index;
}
