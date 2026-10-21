import { afterEach, describe, expect, it } from 'vitest';
import { EngineInputError } from '../../errors';
import { PLAN_MIGRATIONS, PLAN_SCHEMA_VERSION, migratePlan } from '../migrate';
import { makeLPlan } from '../testing/fixtures';

function catchError(fn: () => unknown): EngineInputError {
    try {
        fn();
    } catch (error) {
        if (error instanceof EngineInputError) return error;
        throw error;
    }
    throw new Error('expected EngineInputError');
}

describe('migratePlan', () => {
    afterEach(() => {
        delete PLAN_MIGRATIONS[0];
    });

    it('is at version 1 with an empty registry', () => {
        expect(PLAN_SCHEMA_VERSION).toBe(1);
        expect(Object.keys(PLAN_MIGRATIONS)).toEqual([]);
    });

    it('returns an equal document for v1 input, without mutating it', () => {
        const doc = makeLPlan();
        const snapshot = structuredClone(doc);
        const migrated = migratePlan({ ...doc, schemaVersion: 1 });
        expect(migrated).toEqual(doc);
        expect(doc).toEqual(snapshot);
    });

    it('rejects a newer schemaVersion with unsupported_schema_version', () => {
        const error = catchError(() =>
            migratePlan({ ...makeLPlan(), schemaVersion: 2 }),
        );
        expect(error.code).toBe('unsupported_schema_version');
    });

    it('rejects a version with no registered step as unsupported_schema_version', () => {
        const error = catchError(() =>
            migratePlan({ ...makeLPlan(), schemaVersion: 0 }),
        );
        expect(error.code).toBe('unsupported_schema_version');
    });

    it.each([
        ['a string', 'nope'],
        ['null', null],
        ['an array', []],
        ['no schemaVersion', {}],
        ['a fractional version', { schemaVersion: 1.5 }],
        ['a string version', { schemaVersion: '1' }],
        ['a negative version', { schemaVersion: -1 }],
    ])('rejects %s with invalid_input', (_name, input) => {
        expect(catchError(() => migratePlan(input)).code).toBe('invalid_input');
    });

    it('reports schema failures as invalid_input with details', () => {
        const doc = makeLPlan();
        const [wall] = Object.values(doc.walls);
        if (!wall) throw new Error('no wall');
        wall.thickness = 115.5;
        const error = catchError(() => migratePlan(doc));
        expect(error.code).toBe('invalid_input');
        expect(error.details).toMatchObject({ issues: expect.any(Array) });
    });

    it('runs registered steps in order up to the current version', () => {
        const calls: number[] = [];
        PLAN_MIGRATIONS[0] = (input) => {
            calls.push(0);
            const { legacyTitle, ...rest } = input as Record<
                string,
                unknown
            > & {
                legacyTitle?: string;
            };
            expect(legacyTitle).toBe('old');
            // the step does not touch schemaVersion: the runner stamps it
            return rest;
        };
        const doc = makeLPlan();
        const migrated = migratePlan({
            ...doc,
            schemaVersion: 0,
            legacyTitle: 'old',
        });
        expect(calls).toEqual([0]);
        expect(migrated).toEqual(doc);
        expect(migrated.schemaVersion).toBe(1);
    });

    it('rejects a step that returns a non-object', () => {
        PLAN_MIGRATIONS[0] = () => 'broken';
        const error = catchError(() =>
            migratePlan({ ...makeLPlan(), schemaVersion: 0 }),
        );
        expect(error.code).toBe('invalid_input');
    });

    it('does not run steps for an already current document', () => {
        PLAN_MIGRATIONS[0] = () => {
            throw new Error('must not run');
        };
        expect(() => migratePlan(makeLPlan())).not.toThrow();
    });
});

describe('EngineInputError', () => {
    it('carries code and details and is an Error', () => {
        const error = new EngineInputError('invalid_input', 'bad', { a: 1 });
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('EngineInputError');
        expect(error.code).toBe('invalid_input');
        expect(error.details).toEqual({ a: 1 });
        expect(error.message).toBe('bad');
    });
});
