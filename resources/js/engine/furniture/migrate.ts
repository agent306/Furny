import { EngineInputError } from '../errors';
import { FurnitureDocumentSchema, type FurnitureDocument } from './schema';

/** Current furniture `schemaVersion` (03 §4). */
export const FURNITURE_SCHEMA_VERSION = 1;

/**
 * Registry of upgrade steps keyed by the version they upgrade FROM: entry `n`
 * turns a version-`n` document into a version-`n + 1` one. Empty for v1.
 */
export const FURNITURE_MIGRATIONS: Record<number, (doc: unknown) => unknown> =
    {};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Upgrade any supported furniture document to the current version, step by
 * step, then validate it structurally. Throws `EngineInputError`.
 */
export function migrateFurniture(doc: unknown): FurnitureDocument {
    if (!isRecord(doc)) {
        throw new EngineInputError(
            'invalid_input',
            'Furniture document must be an object',
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
            'Furniture document has no valid schemaVersion',
            { schemaVersion: version },
        );
    }
    if (version > FURNITURE_SCHEMA_VERSION) {
        throw new EngineInputError(
            'unsupported_schema_version',
            `Furniture schemaVersion ${version} is newer than supported ${FURNITURE_SCHEMA_VERSION}`,
            { schemaVersion: version, supported: FURNITURE_SCHEMA_VERSION },
        );
    }

    let current: unknown = doc;
    while (version < FURNITURE_SCHEMA_VERSION) {
        const step = FURNITURE_MIGRATIONS[version];
        if (step === undefined) {
            throw new EngineInputError(
                'unsupported_schema_version',
                `No migration from furniture schemaVersion ${version}`,
                { schemaVersion: version, supported: FURNITURE_SCHEMA_VERSION },
            );
        }
        const next = step(current);
        if (!isRecord(next)) {
            throw new EngineInputError(
                'invalid_input',
                `Migration from furniture schemaVersion ${version} did not return an object`,
            );
        }
        version += 1;
        current = { ...next, schemaVersion: version };
    }

    const parsed = FurnitureDocumentSchema.safeParse(current);
    if (!parsed.success) {
        throw new EngineInputError(
            'invalid_input',
            'Furniture document failed schema validation',
            { issues: parsed.error.issues },
        );
    }
    return parsed.data;
}
