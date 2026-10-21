import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { useControlSize } from '@/composables/useControlSize';

const Probe = defineComponent({
    setup() {
        const size = useControlSize();

        return () => h('span', size.value);
    },
});

function sizeUnder(density?: string): string {
    return mount(Probe, {
        global: density === undefined ? {} : { provide: { density } },
    }).text();
}

describe('useControlSize (15 §3.3)', () => {
    it('comfortable density gives the lg (h-11) control size', () => {
        expect(sizeUnder('comfortable')).toBe('lg');
    });

    it('compact density gives the default (h-9) control size', () => {
        expect(sizeUnder('compact')).toBe('default');
    });

    it('falls back to the touch-friendly size without an AppShell', () => {
        expect(sizeUnder()).toBe('lg');
    });

    it('follows a density that changes after mount', async () => {
        const density = ref('comfortable');
        const wrapper = mount(Probe, { global: { provide: { density } } });

        expect(wrapper.text()).toBe('lg');

        density.value = 'compact';
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toBe('default');
    });
});
