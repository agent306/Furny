import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import StickyActionBar from '@/components/common/StickyActionBar.vue';

describe('StickyActionBar', () => {
    it('is hidden unless the form is dirty', () => {
        const wrapper = mount(StickyActionBar, { props: { dirty: false } });

        expect(wrapper.find('[data-slot="sticky-action-bar"]').exists()).toBe(
            false,
        );
        expect(wrapper.text()).toBe('');
    });

    it('appears with the message, Discard and Save when dirty', () => {
        const wrapper = mount(StickyActionBar, { props: { dirty: true } });

        expect(wrapper.text()).toContain('Unsaved changes');
        expect(wrapper.text()).toContain('Discard');
        expect(wrapper.text()).toContain('Save changes');
    });

    it('Discard emits discard and never submits', async () => {
        const wrapper = mount(StickyActionBar, { props: { dirty: true } });
        const discard = wrapper
            .findAll('button')
            .find((b) => b.text() === 'Discard');

        expect(discard?.attributes('type')).toBe('button');

        await discard?.trigger('click');

        expect(wrapper.emitted('discard')).toHaveLength(1);
    });

    it('Save is a submit button that can target a form elsewhere', () => {
        const wrapper = mount(StickyActionBar, {
            props: { dirty: true, form: 'profile-form' },
        });
        const save = wrapper
            .findAll('button')
            .find((b) => b.text() === 'Save changes');

        expect(save?.attributes('type')).toBe('submit');
        expect(save?.attributes('form')).toBe('profile-form');
    });

    it('disables both buttons while processing', () => {
        const wrapper = mount(StickyActionBar, {
            props: { dirty: true, processing: true },
        });

        for (const button of wrapper.findAll('button')) {
            expect(button.attributes('disabled')).toBeDefined();
        }
    });

    it('is a labelled region sitting above page content', () => {
        const bar = mount(StickyActionBar, { props: { dirty: true } }).get(
            '[data-slot="sticky-action-bar"]',
        );

        expect(bar.attributes('role')).toBe('region');
        expect(bar.attributes('aria-label')).toBe('Unsaved changes');
        expect(bar.classes()).toContain('sticky');
        expect(bar.classes()).toContain('z-10');
    });
});
