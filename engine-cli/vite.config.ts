import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Builds the server-side engine CLI (01 §5.4): one self-contained ES module
// for Node 22 with every dependency bundled.
export default defineConfig({
    publicDir: false,
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('../resources/js', import.meta.url)),
        },
    },
    ssr: {
        noExternal: true,
    },
    build: {
        ssr: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
        target: 'node22',
        outDir: fileURLToPath(new URL('./dist', import.meta.url)),
        emptyOutDir: true,
        minify: false,
        rolldownOptions: {
            output: {
                format: 'es',
                entryFileNames: 'cli.mjs',
            },
        },
    },
});
