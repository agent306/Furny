import { inject } from 'vue';
import { I18N_KEY } from '@/lib/i18n';
import type { I18n } from '@/lib/i18n';

export function useI18n(): I18n {
    const i18n = inject(I18N_KEY, null);

    if (i18n === null) {
        throw new Error(
            'useI18n() needs the i18n plugin: app.use(createI18n(…)).',
        );
    }

    return i18n;
}
