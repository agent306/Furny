import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, provide } from 'vue';
import RichText from '@/components/common/RichText.vue';
import { createI18n, I18N_KEY } from '@/lib/i18n';

const i18n = createI18n({
    locale: 'en',
    messages: {
        'x.caption':
            'By going on you accept the <terms>Terms of {site}</terms> and <privacy>Privacy</privacy>.',
        'x.plain': 'Just {name}',
    },
});

function render(
    messageKey: string,
    params: Record<string, unknown> = {},
    slots: Record<string, (props: { text: string }) => unknown> = {},
) {
    return mount(
        defineComponent({
            setup() {
                // This page's own messages, in place of the app's.
                provide(I18N_KEY, i18n);

                return () =>
                    h('p', [
                        h(RichText, { messageKey, params }, slots as never),
                    ]);
            },
        }),
    );
}

describe('RichText', () => {
    it('renders a message with tags as text and the content of the slots', () => {
        const wrapper = render(
            'x.caption',
            { site: 'Furny' },
            {
                terms: ({ text }) => h('a', { href: '/terms' }, text),
                privacy: ({ text }) => h('a', { href: '/privacy' }, text),
            },
        );

        expect(wrapper.text()).toBe(
            'By going on you accept the Terms of Furny and Privacy.',
        );
        expect(wrapper.get('a[href="/terms"]').text()).toBe('Terms of Furny');
        expect(wrapper.get('a[href="/privacy"]').text()).toBe('Privacy');
    });

    it('shows the text of a tag that has no slot, so nothing is lost', () => {
        const wrapper = render('x.caption', { site: 'Furny' });

        expect(wrapper.text()).toBe(
            'By going on you accept the Terms of Furny and Privacy.',
        );
        expect(wrapper.find('a').exists()).toBe(false);
    });

    it('renders a message without tags as its text', () => {
        expect(render('x.plain', { name: 'Asha' }).text()).toBe('Just Asha');
    });
});
