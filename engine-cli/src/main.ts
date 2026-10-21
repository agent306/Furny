// Entry of the built CLI (engine-cli/dist/cli.mjs): always runs, however the
// file is reached (symlinks included). cli.ts stays import-safe for tests.
import { main } from './cli';

void main();
