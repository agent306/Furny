/**
 * Guillotine sheet nesting (08 §5.3). This is the verbatim, normative 08 §5.3
 * algorithm with type-level edits only (non-null assertions for
 * `noUncheckedIndexedAccess`, preflight C7): control flow and order are
 * unchanged. The 08 §10.4 cases and the property tests prove equivalence.
 */
type Mm = number; // integer millimetres

export type NestRotation = 'free' | 'length_along_sheet' | 'width_along_sheet';

export interface NestItem {
    rowKey: string;
    partKey: string; // instance key (key, key#2, …)
    length: Mm; // cut length
    width: Mm; // cut width
    rotation: NestRotation;
}
export interface NestSheetSpec {
    materialCode: string;
    sheetLength: Mm;
    sheetWidth: Mm;
}
export interface NestOptions {
    kerf: Mm;
    trim: Mm;
}
export interface NestPlacement {
    rowKey: string;
    partKey: string;
    x: Mm;
    y: Mm;
    length: Mm;
    width: Mm;
    rotated: boolean;
}
export interface NestCut {
    x1: Mm;
    y1: Mm;
    x2: Mm;
    y2: Mm;
}
export interface NestedSheet {
    materialCode: string;
    sheetLength: Mm;
    sheetWidth: Mm;
    placements: NestPlacement[];
    utilization: number;
    cuts: NestCut[];
}
export interface NestMaterialResult {
    sheets: NestedSheet[];
    unplaced: string[];
}

interface FreeRect {
    x: Mm;
    y: Mm;
    w: Mm;
    h: Mm;
} // w along sheet x, h along sheet y
interface Orientation {
    rotated: boolean;
    w: Mm;
    h: Mm;
}
interface WorkSheet {
    free: FreeRect[];
    placements: NestPlacement[];
    cuts: NestCut[];
    usedArea: number;
}
type SortRule = 'longest_side' | 'area';
type SplitRule = 'shorter_leftover_axis' | 'max_area';

export const NEST_PASSES: ReadonlyArray<readonly [SortRule, SplitRule]> = [
    ['longest_side', 'shorter_leftover_axis'],
    ['longest_side', 'max_area'],
    ['area', 'shorter_leftover_axis'],
    ['area', 'max_area'],
];

function compareStr(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function sortItems(items: NestItem[], rule: SortRule): NestItem[] {
    return [...items].sort((a, b) => {
        const aMax = Math.max(a.length, a.width),
            bMax = Math.max(b.length, b.width);
        const aMin = Math.min(a.length, a.width),
            bMin = Math.min(b.length, b.width);
        if (rule === 'longest_side') {
            if (aMax !== bMax) return bMax - aMax;
            if (aMin !== bMin) return bMin - aMin;
        } else {
            const aArea = a.length * a.width,
                bArea = b.length * b.width;
            if (aArea !== bArea) return bArea - aArea;
            if (aMax !== bMax) return bMax - aMax;
        }
        return compareStr(a.partKey, b.partKey);
    });
}

function orientations(item: NestItem): Orientation[] {
    const normal: Orientation = {
        rotated: false,
        w: item.length,
        h: item.width,
    };
    const turned: Orientation = {
        rotated: true,
        w: item.width,
        h: item.length,
    };
    if (item.rotation === 'length_along_sheet') return [normal];
    if (item.rotation === 'width_along_sheet') return [turned];
    return item.length === item.width ? [normal] : [normal, turned];
}

interface Choice {
    sheet: number;
    rect: number;
    o: Orientation;
    areaFit: number;
    shortFit: number;
    y: Mm;
    x: Mm;
}

function better(a: Choice, b: Choice | null): boolean {
    if (b === null) return true;
    if (a.areaFit !== b.areaFit) return a.areaFit < b.areaFit;
    if (a.shortFit !== b.shortFit) return a.shortFit < b.shortFit;
    if (a.sheet !== b.sheet) return a.sheet < b.sheet;
    if (a.y !== b.y) return a.y < b.y;
    if (a.x !== b.x) return a.x < b.x;
    return !a.o.rotated && b.o.rotated;
}

function findChoice(
    sheets: WorkSheet[],
    from: number,
    os: Orientation[],
): Choice | null {
    let best: Choice | null = null;
    for (let s = from; s < sheets.length; s++) {
        const free = sheets[s]!.free;
        for (let r = 0; r < free.length; r++) {
            const fr = free[r]!;
            for (const o of os) {
                if (o.w > fr.w || o.h > fr.h) continue;
                const c: Choice = {
                    sheet: s,
                    rect: r,
                    o,
                    areaFit: fr.w * fr.h - o.w * o.h,
                    shortFit: Math.min(fr.w - o.w, fr.h - o.h),
                    y: fr.y,
                    x: fr.x,
                };
                if (better(c, best)) best = c;
            }
        }
    }
    return best;
}

function place(
    sheet: WorkSheet,
    c: Choice,
    item: NestItem,
    kerf: Mm,
    split: SplitRule,
    minSide: Mm,
): void {
    const r = sheet.free[c.rect]!;
    sheet.free.splice(c.rect, 1);
    const pw = c.o.w,
        ph = c.o.h;
    sheet.placements.push({
        rowKey: item.rowKey,
        partKey: item.partKey,
        x: r.x,
        y: r.y,
        length: item.length,
        width: item.width,
        rotated: c.o.rotated,
    });
    sheet.usedArea += pw * ph;
    const rightW = r.w - pw - kerf; // leftover along x after the kerf
    const topH = r.h - ph - kerf; // leftover along y after the kerf
    let horizontalFirst: boolean; // true: first cut is along x at y = r.y + ph, spanning the full free rect
    if (split === 'shorter_leftover_axis') {
        horizontalFirst = r.w - pw < r.h - ph;
    } else {
        const hBest = Math.max(
            Math.max(rightW, 0) * ph,
            r.w * Math.max(topH, 0),
        );
        const vBest = Math.max(
            Math.max(rightW, 0) * r.h,
            pw * Math.max(topH, 0),
        );
        horizontalFirst = hBest >= vBest;
    }
    const add = (f: FreeRect): void => {
        if (f.w >= minSide && f.h >= minSide) sheet.free.push(f);
    };
    if (horizontalFirst) {
        if (ph < r.h)
            sheet.cuts.push({
                x1: r.x,
                y1: r.y + ph,
                x2: r.x + r.w,
                y2: r.y + ph,
            });
        if (pw < r.w)
            sheet.cuts.push({
                x1: r.x + pw,
                y1: r.y,
                x2: r.x + pw,
                y2: r.y + ph,
            });
        if (topH > 0) add({ x: r.x, y: r.y + ph + kerf, w: r.w, h: topH });
        if (rightW > 0) add({ x: r.x + pw + kerf, y: r.y, w: rightW, h: ph });
    } else {
        if (pw < r.w)
            sheet.cuts.push({
                x1: r.x + pw,
                y1: r.y,
                x2: r.x + pw,
                y2: r.y + r.h,
            });
        if (ph < r.h)
            sheet.cuts.push({
                x1: r.x,
                y1: r.y + ph,
                x2: r.x + pw,
                y2: r.y + ph,
            });
        if (rightW > 0) add({ x: r.x + pw + kerf, y: r.y, w: rightW, h: r.h });
        if (topH > 0) add({ x: r.x, y: r.y + ph + kerf, w: pw, h: topH });
    }
}

interface PassResult {
    sheets: WorkSheet[];
    unplaced: string[];
}

function runPass(
    items: NestItem[],
    spec: NestSheetSpec,
    opts: NestOptions,
    sortRule: SortRule,
    split: SplitRule,
): PassResult {
    const usableL = spec.sheetLength - 2 * opts.trim;
    const usableW = spec.sheetWidth - 2 * opts.trim;
    const sorted = sortItems(items, sortRule);
    // free rects smaller than the smallest part side can never be used; dropping them keeps lists short
    const minSide = sorted.reduce(
        (m, i) => Math.min(m, i.length, i.width),
        Number.POSITIVE_INFINITY,
    );
    const sheets: WorkSheet[] = [];
    const unplaced: string[] = [];
    for (const item of sorted) {
        const os = orientations(item).filter(
            (o) => o.w <= usableL && o.h <= usableW,
        );
        if (os.length === 0) {
            unplaced.push(item.partKey);
            continue;
        }
        let choice = findChoice(sheets, 0, os);
        if (choice === null) {
            sheets.push({
                free: [{ x: opts.trim, y: opts.trim, w: usableL, h: usableW }],
                placements: [],
                cuts: [],
                usedArea: 0,
            });
            choice = findChoice(sheets, sheets.length - 1, os);
            if (choice === null) {
                unplaced.push(item.partKey);
                continue;
            } // unreachable: os fits an empty sheet
        }
        place(sheets[choice.sheet]!, choice, item, opts.kerf, split, minSide);
    }
    return { sheets, unplaced };
}

export function nestMaterial(
    items: NestItem[],
    spec: NestSheetSpec,
    opts: NestOptions,
): NestMaterialResult {
    let best: PassResult | null = null;
    for (const [sortRule, split] of NEST_PASSES) {
        const res = runPass(items, spec, opts, sortRule, split);
        if (best === null) {
            best = res;
            continue;
        }
        const a = res.sheets.length,
            b = best.sheets.length;
        const aLast = a === 0 ? 0 : res.sheets[a - 1]!.usedArea;
        const bLast = b === 0 ? 0 : best.sheets[b - 1]!.usedArea;
        if (a < b || (a === b && aLast < bLast)) best = res;
    }
    const out = best as PassResult;
    const sheetArea = spec.sheetLength * spec.sheetWidth;
    return {
        sheets: out.sheets.map((s) => ({
            materialCode: spec.materialCode,
            sheetLength: spec.sheetLength,
            sheetWidth: spec.sheetWidth,
            placements: s.placements,
            cuts: s.cuts,
            utilization: Math.round((s.usedArea / sheetArea) * 10000) / 10000,
        })),
        unplaced: [...out.unplaced].sort(compareStr),
    };
}
