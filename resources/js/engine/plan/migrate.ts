import { EngineInputError } from '../errors';
import { PlanDocumentSchema, type PlanDocument } from './schema';

/** Current plan `schemaVersion` (03 §4). */
export const PLAN_SCHEMA_VERSION = 1;

/**
 * Registry of upgrade steps keyed by the version they upgrade FROM: entry `n`
 * turns a version-`n` document into a version-`n + 1` one. Empty for v1.
 */
export const PLAN_MIGRATIONS: Record<number, (doc: unknown) => unknown> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Upgrade any supported plan document to the current version, step by step,
 * then validate it structurally. Throws `EngineInputError`.
 */
export function migratePlan(doc: unknown): PlanDocument {
    if (!isRecord(doc)) {
        throw new EngineInputError(
            'invalid_input',
            'Plan document must be an object',
        );
    }
    let version = doc.schemaVersion;
    if (
        typeof version !== 'number' ||
        !Number.isInteger(version) ||
        version < 0
    ) {
        throw new EngineInputError(
            'invalid_input',
            'Plan document has no valid schemaVersion',
            { schemaVersion: version },
        );
    }
    if (version > PLAN_SCHEMA_VERSION) {
        throw new EngineInputError(
            'unsupported_schema_version',
            `Plan schemaVersion ${version} is newer than supported ${PLAN_SCHEMA_VERSION}`,
            { schemaVersion: version, supported: PLAN_SCHEMA_VERSION },
        );
    }

    let current: unknown = doc;
    while (version < PLAN_SCHEMA_VERSION) {
        const step = PLAN_MIGRATIONS[version];
        if (step === undefined) {
            throw new EngineInputError(
                'unsupported_schema_version',
                `No migration from plan schemaVersion ${version}`,
                { schemaVersion: version, supported: PLAN_SCHEMA_VERSION },
            );
        }
        const next = step(current);
        if (!isRecord(next)) {
            throw new EngineInputError(
                'invalid_input',
                `Migration from plan schemaVersion ${version} did not return an object`,
            );
        }
        version += 1;
        current = { ...next, schemaVersion: version };
    }

    const parsed = PlanDocumentSchema.safeParse(current);
    if (!parsed.success) {
        throw new EngineInputError(
            'invalid_input',
            'Plan document failed schema validation',
            {
                issues: parsed.error.issues,
            },
        );
    }
    return parsed.data;
}
