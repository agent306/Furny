import { execFile } from 'node:child_process';
import path from 'node:path';
import type { Plugin } from 'vite';

const DEBOUNCE_MS = 300;

/**
 * Dev only (15 §15.3): re-exports the translations when a lang file changes
 * (debounced), then reloads the page so the new messages are loaded.
 */
export function i18nWatch(): Plugin {
    return {
        name: 'furny:i18n-watch',
        apply: 'serve',
        configureServer(server) {
            const langRoot = path.resolve(server.config.root, 'resources/lang');
            let timer: ReturnType<typeof setTimeout> | undefined;

            const exportTranslations = () => {
                execFile(
                    'php',
                    ['artisan', 'i18n:export'],
                    { cwd: server.config.root },
                    (error, stdout, stderr) => {
                        if (error) {
                            server.config.logger.error(
                                `i18n:export failed\n${stdout}${stderr}`,
                            );

                            return;
                        }

                        server.ws.send({ type: 'full-reload' });
                    },
                );
            };

            const onLangFileChange = (file: string) => {
                const relative = path.relative(langRoot, file);

                if (relative.startsWith('..') || !file.endsWith('.php')) {
                    return;
                }

                clearTimeout(timer);
                timer = setTimeout(exportTranslations, DEBOUNCE_MS);
            };

            server.watcher.add(langRoot);
            server.watcher.on('add', onLangFileChange);
            server.watcher.on('change', onLangFileChange);
            server.watcher.on('unlink', onLangFileChange);
        },
    };
}
