import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts', 'check-bench.mjs');
const dir = mkdtempSync(join(tmpdir(), 'check-bench-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const report = (
    benchmarks: Array<{ name: string; median: number; p99: number }>,
) => ({
    files: [
        { filepath: 'a.bench.ts', groups: [{ fullName: 'g', benchmarks }] },
    ],
});

function run(benchmarks: Parameters<typeof report>[0], thresholds: object) {
    const reportPath = join(dir, 'bench.json');
    const thresholdsPath = join(dir, 'thresholds.json');
    writeFileSync(reportPath, JSON.stringify(report(benchmarks)));
    writeFileSync(thresholdsPath, JSON.stringify(thresholds));
    return spawnSync('node', [SCRIPT, reportPath, thresholdsPath], {
        encoding: 'utf8',
    });
}

describe('scripts/check-bench.mjs (16 §10)', () => {
    const fast = { name: 'op', median: 4, p99: 9 };

    it('passes when every median and p95 is within its threshold', () => {
        const res = run([fast], { op: { median: 5, p95: 10 } });
        expect(res.status).toBe(0);
        expect(res.stdout).toContain('ok   op median');
    });

    it('fails when a median exceeds its threshold', () => {
        const res = run([fast], { op: { median: 3 } });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('op: median 4 ms > 3 ms');
    });

    it('fails when the tail exceeds the p95 threshold', () => {
        const res = run([fast], { op: { median: 5, p95: 8 } });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('op: p95 9 ms > 8 ms');
    });

    it('fails when a thresholded benchmark is missing from the report', () => {
        const res = run([fast], { op: { median: 5 }, gone: { median: 5 } });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('gone: no such benchmark');
    });

    it('fails on an unknown threshold metric instead of skipping it', () => {
        const res = run([fast], { op: { medain: 5 } });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('unknown threshold metric "medain"');
    });

    it('prints a FAIL line, not a crash, for a non-numeric measurement', () => {
        const res = run([{ ...fast, median: 'n/a' as unknown as number }], {
            op: { median: 5 },
        });
        expect(res.status).toBe(1);
        expect(res.stderr).not.toContain('TypeError');
        expect(res.stdout).toContain('FAIL op median');
    });

    it('fails on duplicate benchmark names instead of overwriting', () => {
        const res = run([fast, fast], { op: { median: 5 } });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('duplicate benchmark name "op"');
    });
});
