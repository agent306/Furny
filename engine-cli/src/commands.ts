import { z } from 'zod';
import {
    ENGINE_VERSION,
    EngineInputError,
    bomOptionsFor,
    computeBom,
    cutListCsv,
    diffFurniture,
    generateFurniture,
    indexCatalog,
    isSaveBlocking,
    migrateFurniture,
    migratePlan,
    planSummary,
    priceBom,
    removeOrphanNodes,
    templateDefaultDocument,
    validateFurniture,
    validatePlan,
    type Bom,
} from '../../resources/js/engine/index';
import {
    ComputeBomRequestSchema,
    CutlistCsvRequestSchema,
    DiffFurnitureRequestSchema,
    FurnitureRequestSchema,
    PlanRequestSchema,
    TemplateDefaultRequestSchema,
} from './requests';

export const CLI_COMMANDS = [
    'validate-plan',
    'validate-furniture',
    'compute-bom',
    'cutlist-csv',
    'template-default',
    'diff-furniture',
    'plan-summary',
    'version',
] as const;

export const CLI_ERROR_CODES = [
    'unknown_command',
    'invalid_json',
    'invalid_input',
    'engine_error',
] as const;

/** Response envelope of every engine CLI command (01 §5.4). */
export type CliResponse =
    | { ok: true; result: unknown }
    | {
          ok: false;
          error: { code: string; message: string; details?: unknown };
      };

/** Hooks for tests; the real CLI passes none. */
export interface DispatchOptions {
    /** Id factory for generated documents (`template-default`); default: nanoid ids. */
    newId?: (prefix: 's' | 'fr') => string;
}

type Command = (input: unknown, options: DispatchOptions) => unknown;

const DEFAULT_PRICE = { quantity: 1, includeInstallation: true };

const COMMANDS: Readonly<Record<(typeof CLI_COMMANDS)[number], Command>> = {
    'validate-plan': (input) => {
        const migrated = migratePlan(PlanRequestSchema.parse(input).document);
        const issues = validatePlan(migrated);
        // 03 §1.1: orphan nodes are auto-fixed on save
        const migratedDocument = removeOrphanNodes(migrated);
        return {
            valid: !issues.some((issue) => issue.severity === 'error'),
            issues,
            migratedDocument,
            summary: planSummary(migratedDocument),
        };
    },
    'validate-furniture': (input) => {
        const request = FurnitureRequestSchema.parse(input);
        const migratedDocument = migrateFurniture(request.document);
        const issues = validateFurniture(migratedDocument, request.catalog);
        return {
            valid: !isSaveBlocking(issues),
            issues,
            migratedDocument,
            // 03 §5 server step 4 reads the bounding box; generation sets it
            // to the document dims, so it is not generated a second time
            bbox: {
                min: [0, 0, 0],
                size: [
                    migratedDocument.dims.width,
                    migratedDocument.dims.height,
                    migratedDocument.dims.depth,
                ],
            },
        };
    },
    'compute-bom': (input) => {
        const { catalog, options, ...request } =
            ComputeBomRequestSchema.parse(input);
        const document = migrateFurniture(request.document);
        const bom = computeBom(generateFurniture(document, catalog), catalog, {
            ...bomOptionsFor(document, options.nesting),
            ...(options.allowRotation === undefined
                ? {}
                : { allowRotation: options.allowRotation }),
        });
        return {
            bom,
            price: priceBom(
                bom,
                catalog,
                catalog.pricing,
                options.price ?? DEFAULT_PRICE,
            ),
            engineVersion: ENGINE_VERSION,
        };
    },
    'cutlist-csv': (input) => {
        const request = CutlistCsvRequestSchema.parse(input);
        return {
            csv: cutListCsv(
                request.bom as Bom,
                request.catalog,
                migrateFurniture(request.document),
            ),
        };
    },
    'template-default': (input, options) => {
        const request = TemplateDefaultRequestSchema.parse(input);
        return templateDefaultDocument(
            request.templateKey,
            request.overrides,
            indexCatalog(request.catalog),
            options.newId,
        );
    },
    'diff-furniture': (input) => {
        const request = DiffFurnitureRequestSchema.parse(input);
        return {
            changes: diffFurniture(
                request.before,
                request.after,
                request.catalog,
            ),
        };
    },
    'plan-summary': (input) =>
        planSummary(migratePlan(PlanRequestSchema.parse(input).document)),
    version: () => ({ engineVersion: ENGINE_VERSION }),
};

const isCommand = (name: string): name is (typeof CLI_COMMANDS)[number] =>
    (CLI_COMMANDS as readonly string[]).includes(name);

function fail(code: string, message: string, details?: unknown): CliResponse {
    return {
        ok: false,
        error:
            details === undefined
                ? { code, message }
                : { code, message, details },
    };
}

function failure(error: unknown): CliResponse {
    if (error instanceof z.ZodError) {
        return fail('invalid_input', 'The request is not valid.', {
            issues: error.issues,
        });
    }
    if (error instanceof EngineInputError) {
        const extra =
            typeof error.details === 'object' && error.details !== null
                ? error.details
                : {};
        return fail('invalid_input', error.message, {
            ...extra,
            code: error.code,
        });
    }
    // Stack overflow on a too deep document and money overflow are both
    // RangeErrors: the input is at fault, not the engine.
    if (error instanceof RangeError) {
        return fail('invalid_input', error.message);
    }
    return fail(
        'engine_error',
        error instanceof Error ? error.message : String(error),
    );
}

/** Runs one command on its raw stdin text; never throws. */
export function dispatch(
    command: string,
    rawInput: string,
    options: DispatchOptions = {},
): CliResponse {
    if (!isCommand(command)) {
        return fail('unknown_command', `Unknown command "${command}".`);
    }

    let input: unknown;

    try {
        input = JSON.parse(rawInput);
    } catch (error) {
        return fail(
            'invalid_json',
            'The request on stdin is not valid JSON.',
            error instanceof Error ? error.message : undefined,
        );
    }

    try {
        return { ok: true, result: COMMANDS[command](input, options) };
    } catch (error) {
        return failure(error);
    }
}
