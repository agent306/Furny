/**
 * Fixture commands (04 §6.6): `addFixture`, `moveFixture`, `setFixtureProps`
 * and `deleteFixtures`. A fixture's `x, y` is the centre of its footprint
 * (03), so `keep` in `setFixtureProps` names the footprint corner that stays
 * where it is when the width or depth changes (the editor passes the corner
 * opposite to the handle being dragged, 05 §7).
 *
 * `validate` and `run` share one planner per command (see `openings.ts`).
 * None of these commands changes the walls, so none runs the geometry
 * post-processing.
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - 04 §6.6 words `keep` as "the opposite corner stays fixed"; the corner
 *   named by `keep` is the one that stays fixed (the editor already passes
 *   the opposite of the dragged handle).
 * - A corner `keep` moves `x, y` only when the width or the depth ends up
 *   different; a rotation given in the same command turns the footprint about
 *   the kept corner.
 * - `libraryKey` resets the sizes only when it differs from the fixture's
 *   current key.
 * - `label` is stored as given (not trimmed); the spec sets no limit on it.
 */
import { z } from 'zod';
import { CommandAbort } from '../../commands/types';
import { add, frontVector, scale, type Vec2 } from '../../geometry/vec2';
import { FIXTURE_KEYS, FIXTURE_LIBRARY, type FixtureKey } from '../fixtures';
import {
    ELEVATION_RANGE,
    FIXTURE_HEIGHT_RANGE,
    FIXTURE_SIZE_RANGE,
    MAX_FIXTURES,
} from '../limits';
import type { Fixture, PlanDocument } from '../schema';
import type { EngineMessage } from '../types';
import { definePlanCommand } from './define';
import { pushDeleted } from './helpers';
import { storedRotation } from './postprocess';
import {
    type Planned,
    checkCollectionCapacity,
    checkCoord,
    checkIds,
    checkRange,
    has,
    hasError,
    message,
    mm,
    notFound,
    uniqueSorted,
} from './validators';

const CORNER_KEYS = [
    'back_left',
    'back_right',
    'front_right',
    'front_left',
] as const;
type CornerKey = (typeof CORNER_KEYS)[number];

// ---- params schemas -------------------------------------------------------------------------

// `libraryKey` is a plain string so an unknown key is `fixture_unknown`, not `invalid_params`.
const AddFixtureSchema = z.object({
    libraryKey: z.string(),
    x: z.number(),
    y: z.number(),
    rotation: z.number().optional(),
    width: z.number().optional(),
    depth: z.number().optional(),
    height: z.number().optional(),
    elevation: z.number().optional(),
    label: z.string().nullable().optional(),
});
type AddFixtureParams = z.infer<typeof AddFixtureSchema>;

const MoveFixtureSchema = z.object({
    fixtureId: z.string(),
    x: z.number(),
    y: z.number(),
    rotation: z.number().optional(),
});
type MoveFixtureParams = z.infer<typeof MoveFixtureSchema>;

const SetFixturePropsSchema = z.object({
    fixtureIds: z.array(z.string()).min(1),
    props: z.object({
        libraryKey: z.string().optional(),
        width: z.number().optional(),
        depth: z.number().optional(),
        height: z.number().optional(),
        elevation: z.number().optional(),
        rotation: z.number().optional(),
        label: z.string().nullable().optional(),
    }),
    keep: z.enum(['center', ...CORNER_KEYS]).optional(),
});
type SetFixturePropsParams = z.infer<typeof SetFixturePropsSchema>;

const DeleteFixturesSchema = z.object({
    fixtureIds: z.array(z.string()).min(1),
});
type DeleteFixturesParams = z.infer<typeof DeleteFixturesSchema>;

// ---- shared ---------------------------------------------------------------------------------------

const isFixtureKey = (key: string): key is FixtureKey =>
    (FIXTURE_KEYS as readonly string[]).includes(key);

/** `fixture_unknown` unless `key` is a library key. */
function checkLibraryKey(key: string): EngineMessage | null {
    return isFixtureKey(key) ? null : message('fixture_unknown', { key });
}

/** Range checks of the size fields of a fixture; `prefix` names the params object. */
function checkSizes(
    f: Pick<Fixture, 'width' | 'depth' | 'height' | 'elevation'>,
    given: { [K in 'width' | 'depth' | 'height' | 'elevation']?: unknown },
    prefix: string,
): EngineMessage | null {
    return (
        (given.width === undefined
            ? null
            : checkRange(`${prefix}width`, f.width, ...FIXTURE_SIZE_RANGE)) ??
        (given.depth === undefined
            ? null
            : checkRange(`${prefix}depth`, f.depth, ...FIXTURE_SIZE_RANGE)) ??
        (given.height === undefined
            ? null
            : checkRange(
                  `${prefix}height`,
                  f.height,
                  ...FIXTURE_HEIGHT_RANGE,
              )) ??
        (given.elevation === undefined
            ? null
            : checkRange(`${prefix}elevation`, f.elevation, ...ELEVATION_RANGE))
    );
}

// ---- addFixture -----------------------------------------------------------------------------------

function planAdd(
    doc: Pick<PlanDocument, 'fixtures'>,
    p: AddFixtureParams,
): Planned<{ fixture: Omit<Fixture, 'id'> }> {
    const unknown = checkLibraryKey(p.libraryKey);
    if (unknown !== null) return { error: unknown };
    const def = FIXTURE_LIBRARY[p.libraryKey as FixtureKey];
    const fixture: Omit<Fixture, 'id'> = {
        libraryKey: def.key,
        x: mm(p.x),
        y: mm(p.y),
        rotation: storedRotation(p.rotation ?? 0),
        width: mm(p.width ?? def.width),
        depth: mm(p.depth ?? def.depth),
        height: mm(p.height ?? def.height),
        elevation: mm(p.elevation ?? def.elevation),
        label: p.label ?? null,
    };
    const refusal =
        checkCoord('x', fixture.x) ??
        checkCoord('y', fixture.y) ??
        checkSizes(fixture, p, '') ??
        checkCollectionCapacity(doc.fixtures, 'fixtures', MAX_FIXTURES);
    return refusal === null ? { fixture } : { error: refusal };
}

export interface AddFixtureResult {
    fixtureId: string;
}

const addFixture = definePlanCommand<AddFixtureParams, AddFixtureResult>({
    type: 'addFixture',
    labelKey: 'engine.plan.command.label.add_fixture',
    paramsSchema: AddFixtureSchema,
    validate(doc, p) {
        const plan = planAdd(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planAdd(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const id = ctx.newId('x');
        d.fixtures[id] = { id, ...plan.fixture };
        out.result = { fixtureId: id };
    },
    touchesGeometry: false,
});

// ---- moveFixture ----------------------------------------------------------------------------------

function planMove(
    doc: Pick<PlanDocument, 'fixtures'>,
    p: MoveFixtureParams,
): Planned<{ x: number; y: number; rotation: number | null }> {
    if (!has(doc.fixtures, p.fixtureId)) {
        return { error: notFound(p.fixtureId) };
    }
    const x = mm(p.x);
    const y = mm(p.y);
    const refusal = checkCoord('x', x) ?? checkCoord('y', y);
    if (refusal !== null) return { error: refusal };
    return {
        x,
        y,
        rotation: p.rotation === undefined ? null : storedRotation(p.rotation),
    };
}

const moveFixture = definePlanCommand<MoveFixtureParams>({
    type: 'moveFixture',
    labelKey: 'engine.plan.command.label.move_fixture',
    paramsSchema: MoveFixtureSchema,
    validate(doc, p) {
        const plan = planMove(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planMove(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const fixture = d.fixtures[p.fixtureId]!;
        fixture.x = plan.x;
        fixture.y = plan.y;
        if (plan.rotation !== null) fixture.rotation = plan.rotation;
    },
    mergeKey: (p) => `fixture:${p.fixtureId}`,
    mergeMode: 'replace',
    touchesGeometry: false,
});

// ---- setFixtureProps ------------------------------------------------------------------------------

/** The side of the footprint a corner is on: `[across (right = +1), along the front (front = +1)]`. */
const CORNER_SIGNS: Record<CornerKey, readonly [number, number]> = {
    back_left: [-1, -1],
    back_right: [1, -1],
    front_right: [1, 1],
    front_left: [-1, 1],
};

/** The vector from the footprint centre to `corner`. */
function cornerOffset(
    corner: CornerKey,
    width: number,
    depth: number,
    rotation: number,
): Vec2 {
    const front = frontVector(rotation);
    const right = { x: front.y, y: -front.x };
    const [across, along] = CORNER_SIGNS[corner];
    return add(
        scale(right, (across * width) / 2),
        scale(front, (along * depth) / 2),
    );
}

type FixtureFields = Omit<Fixture, 'id'>;

/** What `setFixtureProps` makes of one fixture, or the refusal. */
function planProps(
    f: Fixture,
    props: SetFixturePropsParams['props'],
    keep: SetFixturePropsParams['keep'],
): Planned<FixtureFields> {
    const unknown =
        props.libraryKey === undefined
            ? null
            : checkLibraryKey(props.libraryKey);
    if (unknown !== null) return { error: unknown };

    // A new library key brings its own sizes unless they are given.
    const reset =
        props.libraryKey !== undefined && props.libraryKey !== f.libraryKey
            ? FIXTURE_LIBRARY[props.libraryKey as FixtureKey]
            : null;
    const next: FixtureFields = {
        libraryKey:
            props.libraryKey === undefined
                ? f.libraryKey
                : (props.libraryKey as FixtureKey),
        x: f.x,
        y: f.y,
        rotation:
            props.rotation === undefined
                ? f.rotation
                : storedRotation(props.rotation),
        width: mm(props.width ?? reset?.width ?? f.width),
        depth: mm(props.depth ?? reset?.depth ?? f.depth),
        height: mm(props.height ?? reset?.height ?? f.height),
        elevation: mm(props.elevation ?? reset?.elevation ?? f.elevation),
        label: props.label === undefined ? f.label : props.label,
    };
    const refusal = checkSizes(next, props, 'props.');
    if (refusal !== null) return { error: refusal };

    if (
        keep !== undefined &&
        keep !== 'center' &&
        (next.width !== f.width || next.depth !== f.depth)
    ) {
        const was = cornerOffset(keep, f.width, f.depth, f.rotation);
        const now = cornerOffset(keep, next.width, next.depth, next.rotation);
        next.x = mm(f.x + was.x - now.x);
        next.y = mm(f.y + was.y - now.y);
        const moved = checkCoord('x', next.x) ?? checkCoord('y', next.y);
        if (moved !== null) return { error: moved };
    }
    return next;
}

const setFixtureProps = definePlanCommand<SetFixturePropsParams>({
    type: 'setFixtureProps',
    labelKey: 'engine.plan.command.label.set_fixture_props',
    paramsSchema: SetFixturePropsSchema,
    validate(doc, p) {
        const missing = checkIds(doc.fixtures, p.fixtureIds);
        if (missing !== null) return missing;
        for (const id of uniqueSorted(p.fixtureIds)) {
            const plan = planProps(doc.fixtures[id]!, p.props, p.keep);
            if (hasError(plan)) return plan.error;
        }
        return null;
    },
    run(d, p) {
        for (const id of uniqueSorted(p.fixtureIds)) {
            const fixture = d.fixtures[id]!;
            const plan = planProps(fixture, p.props, p.keep);
            if (hasError(plan)) throw new CommandAbort(plan.error);
            fixture.libraryKey = plan.libraryKey;
            fixture.x = plan.x;
            fixture.y = plan.y;
            fixture.rotation = plan.rotation;
            fixture.width = plan.width;
            fixture.depth = plan.depth;
            fixture.height = plan.height;
            fixture.elevation = plan.elevation;
            fixture.label = plan.label;
        }
    },
    mergeKey: (p) => `fixtureProps:${uniqueSorted(p.fixtureIds).join(',')}`,
    mergeMode: 'replace',
    touchesGeometry: false,
});

// ---- deleteFixtures -------------------------------------------------------------------------------

const deleteFixtures = definePlanCommand<DeleteFixturesParams>({
    type: 'deleteFixtures',
    labelKey: 'engine.plan.command.label.delete_fixtures',
    paramsSchema: DeleteFixturesSchema,
    validate: (doc, p) => checkIds(doc.fixtures, p.fixtureIds),
    run(d, p, _ctx, out) {
        const ids = uniqueSorted(p.fixtureIds);
        for (const id of ids) delete d.fixtures[id];
        pushDeleted(out, ...ids);
    },
    touchesGeometry: false,
});

/** The fixture commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const FIXTURE_COMMANDS = {
    addFixture,
    moveFixture,
    setFixtureProps,
    deleteFixtures,
};
