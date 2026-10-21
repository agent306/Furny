// 16 §10: fails when a benchmark in the vitest bench JSON exceeds its CI threshold.
// Usage: node scripts/check-bench.mjs <bench.json> <bench-thresholds.json>
//
// A threshold entry is `{ "median": ms, "p95": ms }` (each optional). Vitest's
// JSON has no p95 and no raw samples, so `p95` is checked against the reported
// `p99`, which is never lower: a pass is a real pass, a miss is conservative.
// A threshold with no matching benchmark fails; benchmarks without a threshold
// are report-only.
import { readFileSync } from 'node:fs';

const [reportPath, thresholdsPath] = process.argv.slice(2);
if (!reportPath || !thresholdsPath) {
    console.error(
        'usage: check-bench.mjs <bench.json> <bench-thresholds.json>',
    );
    process.exit(2);
}

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const report = read(reportPath);
const thresholds = read(thresholdsPath);

const measured = new Map();
for (const file of report.files ?? []) {
    for (const group of file.groups ?? []) {
        for (const bench of group.benchmarks ?? []) {
            if (measured.has(bench.name)) {
                console.error(`duplicate benchmark name "${bench.name}"`);
                process.exit(1);
            }
            measured.set(bench.name, bench);
        }
    }
}

const METRICS = { median: 'median', p95: 'p99' };
const failures = [];
const fmt = (ms) =>
    (typeof ms === 'number' ? ms.toFixed(3) : String(ms)).padStart(9);
for (const [name, limits] of Object.entries(thresholds)) {
    const bench = measured.get(name);
    if (!bench) {
        failures.push(`${name}: no such benchmark in ${reportPath}`);
        continue;
    }
    for (const [metric, limit] of Object.entries(limits)) {
        const source = METRICS[metric];
        if (!source) {
            failures.push(`${name}: unknown threshold metric "${metric}"`);
            continue;
        }
        const value = bench[source];
        const ok = typeof value === 'number' && value <= limit;
        console.log(
            `${ok ? 'ok  ' : 'FAIL'} ${name} ${metric} ${fmt(value)} ms (limit ${limit} ms)`,
        );
        if (!ok) failures.push(`${name}: ${metric} ${value} ms > ${limit} ms`);
    }
}
for (const name of measured.keys()) {
    if (!(name in thresholds)) console.log(`info ${name} (not asserted)`);
}

if (failures.length > 0) {
    console.error(`\n${failures.length} benchmark budget(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}
