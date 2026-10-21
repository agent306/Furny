/// <reference types="node" />
import { dispatch } from './commands';

export { dispatch } from './commands';
export type { CliResponse } from './commands';

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
