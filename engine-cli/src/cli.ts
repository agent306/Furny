/// <reference types="node" />
import { ENGINE_VERSION } from '@/engine';

/** Response envelope of every engine CLI command (01 §5.4). */
export type CliResponse =
    | { ok: true; result: unknown }
    | {
          ok: false;
          error: { code: string; message: string; details?: unknown };
      };

type CommandHandler = (input: unknown) => unknown;

const COMMANDS: Readonly<Record<string, CommandHandler>> = {
    version: () => ({ engineVersion: ENGINE_VERSION }),
};

export function dispatch(command: string, rawInput: string): CliResponse {
    const handler = Object.hasOwn(COMMANDS, command)
        ? COMMANDS[command]
        : undefined;

    if (handler === undefined) {
        return {
            ok: false,
            error: {
                code: 'unknown_command',
                message: `Unknown command "${command}".`,
            },
        };
    }

    let input: unknown;

    try {
        input = JSON.parse(rawInput);
    } catch (error) {
        return {
            ok: false,
            error: {
                code: 'invalid_json',
                message: 'The request on stdin is not valid JSON.',
                details: error instanceof Error ? error.message : undefined,
            },
        };
    }

    return { ok: true, result: handler(input) };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    return Buffer.concat(chunks).toString('utf8');
}

/** Reads the request from stdin, writes one JSON response line, exits 0. */
export async function main(): Promise<void> {
    const response = dispatch(
        process.argv[2] ?? '',
        await readAll(process.stdin),
    );

    process.stdout.write(`${JSON.stringify(response)}\n`);
    process.exitCode = 0;
}
