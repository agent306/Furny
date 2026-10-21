import { describe, expect, it } from 'vitest';
import { HARDWARE_ROLE_KEYS, type HardwareRoleKey } from '../../catalog/specs';
import type { CatalogMaterial } from '../../catalog/snapshot';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';
import { indexCatalog } from '../catalogIndex';
import { DEFAULT_DENSITY } from '../rules/weight';

const MATERIAL_ROLES = [
    'carcass',
    'back',
    'shelf',
    'front',
    'top',
    'drawer_box',
    'drawer_bottom',
    'plinth',
    'leg',
] as const;

describe('indexCatalog: lookups', () => {
    const idx = indexCatalog(seedCatalog());

    it('finds rows by code or key', () => {
        expect(idx.material('PB18-OAK')?.name).toBe('PB 18 mm Natural Oak');
        expect(idx.edgeBand('EB08-WHITE')?.pricePerMeterMinor).toBe(600);
        expect(idx.hardware('HNG-FO-SC')?.priceMinor).toBe(12000);
        expect(idx.finish('FIN-DUCO')?.finishType).toBe('duco');
        expect(idx.labour('cutting_per_sheet')?.rateMinor).toBe(15000);
    });

    it('returns undefined for unknown codes', () => {
        expect(idx.material('NOPE')).toBeUndefined();
        expect(idx.edgeBand('NOPE')).toBeUndefined();
        expect(idx.hardware('NOPE')).toBeUndefined();
        expect(idx.finish('NOPE')).toBeUndefined();
        expect(idx.labour('NOPE')).toBeUndefined();
    });

    it('exposes the snapshot it indexes', () => {
        const snap = seedCatalog();
        expect(indexCatalog(snap).snapshot).toBe(snap);
    });

    it('resolves inactive rows by code', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            for (const m of d.materials) m.isActive = false;
            for (const h of d.hardware) h.isActive = false;
        });
        const i = indexCatalog(snap);
        expect(i.material('PB18-WHITE')?.isActive).toBe(false);
        expect(i.hardware('HNG-FO-SC')?.isActive).toBe(false);
    });
});

describe('indexCatalog: role defaults (07 §2.3, §6.11)', () => {
    const idx = indexCatalog(seedCatalog());

    it('defaultMaterialFor matches the seed role defaults', () => {
        const codes = Object.fromEntries(
            MATERIAL_ROLES.map((r) => [r, idx.defaultMaterialFor(r)?.code]),
        );
        expect(codes).toEqual({
            carcass: 'PB18-WHITE',
            shelf: 'PB18-WHITE',
            front: 'PB18-WHITE',
            top: 'PB18-WHITE',
            plinth: 'PB18-WHITE',
            back: 'HDF3-WHITE',
            drawer_bottom: 'HDF3-WHITE',
            drawer_box: 'PLY12-BWR',
            leg: 'SW50-RUBBER',
        });
    });

    it('defaultMaterialFor skips inactive rows, then falls back to carcass usage, then any active', () => {
        const noPb = mutateCatalog(seedCatalog(), (d) => {
            d.materials.find((m) => m.code === 'PB18-WHITE')!.isActive = false;
        });
        expect(indexCatalog(noPb).defaultMaterialFor('carcass')?.code).toBe(
            'PB18-OAK',
        );

        const noLeg = mutateCatalog(seedCatalog(), (d) => {
            d.materials.find((m) => m.code === 'SW50-RUBBER')!.isActive = false;
        });
        // no active material lists "leg": falls back to the first "carcass" one
        expect(indexCatalog(noLeg).defaultMaterialFor('leg')?.code).toBe(
            'PB18-WHITE',
        );

        const onlyGlass = mutateCatalog(seedCatalog(), (d) => {
            for (const m of d.materials) m.isActive = m.boardType === 'glass';
        });
        expect(
            indexCatalog(onlyGlass).defaultMaterialFor('carcass')?.code,
        ).toBe('GLASS5-CLEAR');

        const none = mutateCatalog(seedCatalog(), (d) => {
            for (const m of d.materials) m.isActive = false;
        });
        expect(
            indexCatalog(none).defaultMaterialFor('carcass'),
        ).toBeUndefined();
    });

    it('defaultMaterialFor orders by sortOrder then code', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            d.materials.find((m) => m.code === 'PLY18-BWR')!.sortOrder = 5;
        });
        expect(indexCatalog(snap).defaultMaterialFor('carcass')?.code).toBe(
            'PLY18-BWR',
        );
        const tie = mutateCatalog(seedCatalog(), (d) => {
            d.materials.find((m) => m.code === 'PLY18-BWR')!.sortOrder = 10;
        });
        // same sortOrder 10 as PB18-WHITE: code asc puts PB18-WHITE first
        expect(indexCatalog(tie).defaultMaterialFor('carcass')?.code).toBe(
            'PB18-WHITE',
        );
    });

    it('defaultHardware resolves the documented role keys', () => {
        expect(idx.defaultHardware('slide.side_mount')?.code).toBe(
            'SLD-BB-450',
        );
        expect(idx.defaultHardware('slide.undermount')?.code).toBe(
            'SLD-UM-450',
        );
        expect(idx.defaultHardware('hinge.full_overlay')?.code).toBe(
            'HNG-FO-SC',
        );
    });

    it('assigns every role key of 07 §6.11 to exactly one seed row', () => {
        const rows = seedCatalog().hardware;
        for (const key of HARDWARE_ROLE_KEYS) {
            const owners = rows.filter((h) => h.isDefaultFor.includes(key));
            expect(owners, key).toHaveLength(1);
            expect(idx.defaultHardware(key)?.code).toBe(owners[0]!.code);
        }
        const allAssigned = rows.flatMap((h) => h.isDefaultFor);
        expect(allAssigned.sort()).toEqual([...HARDWARE_ROLE_KEYS].sort());
    });

    it('defaultHardware skips inactive items and picks by sortOrder, code', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            d.hardware.find((h) => h.code === 'HNG-FO-SC')!.isActive = false;
            const alt = d.hardware.find((h) => h.code === 'HNG-HO-SC')!;
            alt.isDefaultFor.push('hinge.full_overlay');
        });
        expect(
            indexCatalog(snap).defaultHardware('hinge.full_overlay')?.code,
        ).toBe('HNG-HO-SC');

        const gone = mutateCatalog(seedCatalog(), (d) => {
            d.hardware.find((h) => h.code === 'HNG-FO-SC')!.isActive = false;
        });
        expect(
            indexCatalog(gone).defaultHardware('hinge.full_overlay'),
        ).toBeUndefined();

        const tie = mutateCatalog(seedCatalog(), (d) => {
            const a = d.hardware.find((h) => h.code === 'HDL-BAR-320')!;
            a.isDefaultFor.push('handle.default');
            a.sortOrder = 170; // HDL-BAR-160 is row 17 = 170 too
        });
        expect(indexCatalog(tie).defaultHardware('handle.default')?.code).toBe(
            'HDL-BAR-160',
        );
    });
});

describe('indexCatalog: hardwareFamily, glass, density', () => {
    const idx = indexCatalog(seedCatalog());

    it('hardwareFamily lists the active family ordered by length', () => {
        const fam = idx.hardwareFamily('drawer_slide', 'bb45');
        expect(fam.map((h) => h.code)).toEqual([
            'SLD-BB-250',
            'SLD-BB-300',
            'SLD-BB-350',
            'SLD-BB-400',
            'SLD-BB-450',
            'SLD-BB-500',
            'SLD-BB-550',
            'SLD-BB-600',
        ]);
        expect(idx.hardwareFamily('drawer_slide', 'um')).toHaveLength(4);
        expect(idx.hardwareFamily('drawer_slide', 'nope')).toEqual([]);
        expect(idx.hardwareFamily('hinge', 'bb45')).toEqual([]);
    });

    it('hardwareFamily skips inactive rows', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            d.hardware.find((h) => h.code === 'SLD-BB-300')!.isActive = false;
        });
        const fam = indexCatalog(snap).hardwareFamily('drawer_slide', 'bb45');
        expect(fam.map((h) => h.code)).not.toContain('SLD-BB-300');
        expect(fam).toHaveLength(7);
    });

    it('hardwareFamily breaks length ties by code', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            const orig = d.hardware.find((h) => h.code === 'SLD-BB-450')!;
            d.hardware.push({
                ...orig,
                specs: { ...orig.specs },
                isDefaultFor: [],
                id: 'x',
                code: 'SLD-BB-450-A',
            });
        });
        const codes = indexCatalog(snap)
            .hardwareFamily('drawer_slide', 'bb45')
            .map((h) => h.code);
        expect(codes.indexOf('SLD-BB-450')).toBeLessThan(
            codes.indexOf('SLD-BB-450-A'),
        );
        expect(codes.indexOf('SLD-BB-450-A')).toBeLessThan(
            codes.indexOf('SLD-BB-500'),
        );
    });

    it('glassMaterial is the first active glass material', () => {
        expect(idx.glassMaterial()?.code).toBe('GLASS5-CLEAR');
        const off = mutateCatalog(seedCatalog(), (d) => {
            d.materials.find((m) => m.code === 'GLASS5-CLEAR')!.isActive =
                false;
        });
        expect(indexCatalog(off).glassMaterial()).toBeUndefined();
        expect(indexCatalog(off).material('GLASS5-CLEAR')).toBeDefined();
    });

    it('densityOf uses densityKgM3, else the board-type default', () => {
        const hdf = idx.material('HDF3-WHITE') as CatalogMaterial;
        expect(idx.densityOf(hdf)).toBe(900);
        expect(idx.densityOf({ ...hdf, densityKgM3: null })).toBe(900);
        expect(idx.densityOf({ ...hdf, densityKgM3: 321 })).toBe(321);
        const glass = idx.glassMaterial() as CatalogMaterial;
        expect(idx.densityOf({ ...glass, densityKgM3: null })).toBe(2500);
    });

    it('DEFAULT_DENSITY is the 07 §6.1 table', () => {
        expect(DEFAULT_DENSITY).toEqual({
            particle_board: 650,
            mdf: 750,
            hdf: 900,
            plywood: 600,
            blockboard: 550,
            solid_wood: 700,
            glass: 2500,
            acrylic: 1190,
            metal_sheet: 7850,
        });
    });
});

describe('indexCatalog: memoisation', () => {
    it('returns the same index for the same snapshot object', () => {
        const s = seedCatalog();
        expect(indexCatalog(s)).toBe(indexCatalog(s));
    });

    it('returns different indexes for different snapshot objects', () => {
        expect(indexCatalog(seedCatalog())).not.toBe(
            indexCatalog(seedCatalog()),
        );
    });

    it('typechecks role keys', () => {
        const key: HardwareRoleKey = 'lock.default';
        expect(HARDWARE_ROLE_KEYS).toContain(key);
    });
});
