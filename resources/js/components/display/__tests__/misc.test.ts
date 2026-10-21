import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import KeyValueList from '@/components/display/KeyValueList.vue';
import UserAvatar from '@/components/display/UserAvatar.vue';

describe('UserAvatar', () => {
    it('falls back to initials on the wood tint, named for screen readers', () => {
        const wrapper = mount(UserAvatar, {
            props: { user: { name: 'Anita Rao', avatarUrl: null } },
        });

        expect(wrapper.text()).toBe('AR');
        expect(wrapper.attributes('role')).toBe('img');
        expect(wrapper.attributes('aria-label')).toBe('Anita Rao');
        expect(wrapper.html()).toContain('bg-brand-wood-subtle');
    });

    it('uses a single initial for a single name', () => {
        expect(
            mount(UserAvatar, {
                props: { user: { name: 'cher', avatarUrl: null } },
            }).text(),
        ).toBe('C');
    });

    it('sizes differ', () => {
        const classes = (['xs', 'sm', 'md', 'lg'] as const).map((size) =>
            mount(UserAvatar, {
                props: { user: { name: 'A B', avatarUrl: null }, size },
            })
                .classes()
                .join(' '),
        );

        expect(new Set(classes).size).toBe(4);
    });

    it('keeps the accessible name when an image URL is given', () => {
        const wrapper = mount(UserAvatar, {
            props: {
                user: {
                    name: 'Anita Rao',
                    avatarUrl: 'https://example.test/a.png',
                },
            },
        });

        // happy-dom never loads images, so Reka keeps the fallback; the name
        // lives on the root either way.
        expect(wrapper.attributes('role')).toBe('img');
        expect(wrapper.attributes('aria-label')).toBe('Anita Rao');
    });
});

describe('KeyValueList', () => {
    it('renders a description list of label/value pairs', () => {
        const wrapper = mount(KeyValueList, {
            props: {
                items: [
                    { label: 'Order', value: 'ORD-1' },
                    { label: 'City', value: 'Pune' },
                ],
            },
        });

        expect(wrapper.element.tagName).toBe('DL');
        expect(wrapper.findAll('dt').map((n) => n.text())).toEqual([
            'Order',
            'City',
        ]);
        expect(wrapper.findAll('dd').map((n) => n.text())).toEqual([
            'ORD-1',
            'Pune',
        ]);
    });

    it('keeps rows that share a label (no keyed-by-label collapse)', () => {
        const wrapper = mount(KeyValueList, {
            props: {
                items: [
                    { label: 'Phone', value: '111' },
                    { label: 'Phone', value: '222' },
                ],
            },
        });

        expect(wrapper.findAll('dd').map((n) => n.text())).toEqual([
            '111',
            '222',
        ]);
    });

    it('renders a named slot for rich values', () => {
        const wrapper = mount(KeyValueList, {
            props: { items: [{ label: 'Status', slot: 'status' }] },
            slots: { status: '<b data-test="rich">Quoted</b>' },
        });

        expect(wrapper.get('dd').find('[data-test="rich"]').exists()).toBe(
            true,
        );
    });

    it('shows an em dash for a missing value without a slot', () => {
        const wrapper = mount(KeyValueList, {
            props: { items: [{ label: 'Phone' }, { label: 'Fax', value: '' }] },
        });

        expect(wrapper.findAll('dd').map((n) => n.text())).toEqual(['—', '—']);
    });

    it('columns switches between one and two columns', () => {
        const one = mount(KeyValueList, { props: { items: [], columns: 1 } });
        const two = mount(KeyValueList, { props: { items: [], columns: 2 } });

        expect(one.classes().join(' ')).not.toContain('sm:grid-cols-2');
        expect(two.classes().join(' ')).toContain('sm:grid-cols-2');
    });
});
