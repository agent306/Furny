import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { Input } from '@/components/ui/input';

describe('Input control height (15 §3.3)', () => {
    it('is h-9 by default', () => {
        const input = mount(Input).get('input');

        expect(input.classes()).toContain('h-9');
        expect(input.classes()).not.toContain('h-11');
    });

    it('is h-11 for size="lg" and does not leak a native size attribute', () => {
        const input = mount(Input, { props: { size: 'lg' } }).get('input');

        expect(input.classes()).toContain('h-11');
        expect(input.classes()).not.toContain('h-9');
        expect(input.attributes('size')).toBeUndefined();
    });

    it('lets a caller class override the height', () => {
        const input = mount(Input, {
            props: { size: 'lg' },
            attrs: { class: 'h-14' },
        }).get('input');

        expect(input.classes()).toContain('h-14');
        expect(input.classes()).not.toContain('h-11');
    });
});
