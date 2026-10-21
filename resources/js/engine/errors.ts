export type EngineInputErrorCode =
    'invalid_input' | 'unsupported_schema_version';

/**
 * Thrown by the migrate functions when a document cannot be loaded. The engine
 * CLI maps it onto the `{ ok: false, error }` envelope (01 §5.4).
 */
export class EngineInputError extends Error {
    readonly code: EngineInputErrorCode;
    readonly details?: unknown;

    constructor(
        code: EngineInputErrorCode,
        message: string,
        details?: unknown,
    ) {
        super(message);
        this.name = 'EngineInputError';
        this.code = code;
        this.details = details;
    }
}
