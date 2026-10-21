import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

// Smoke renders: the vendored sources resolve their imports and mount under
// happy-dom with the semantic token classes intact.
describe('vendored components render', () => {
    it('Switch toggles and carries its slot', async () => {
        const wrapper = mount(Switch);
        const root = wrapper.get('[data-slot="switch"]');

        expect(root.attributes('role')).toBe('switch');
        expect(root.attributes('aria-checked')).toBe('false');

        await root.trigger('click');

        expect(root.attributes('aria-checked')).toBe('true');
    });

    it('Progress exposes its value', () => {
        const wrapper = mount(Progress, { props: { modelValue: 40 } });

        expect(wrapper.get('[role="progressbar"]').attributes()).toMatchObject({
            'aria-valuenow': '40',
        });
    });

    it('Textarea binds v-model', async () => {
        const wrapper = mount(Textarea, { props: { modelValue: 'a' } });

        await wrapper.get('textarea').setValue('b');

        expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['b']);
    });

    it('Table renders rows and cells', () => {
        const wrapper = mount(Table, {
            slots: {
                default: () =>
                    h(TableBody, () =>
                        h(TableRow, () => h(TableCell, () => 'Oak')),
                    ),
            },
        });

        expect(wrapper.get('table').text()).toBe('Oak');
    });

    it('Tabs show the selected panel', () => {
        const wrapper = mount(Tabs, {
            props: { defaultValue: 'a' },
            slots: {
                default: () => [
                    h(TabsList, () => [
                        h(TabsTrigger, { value: 'a' }, () => 'A'),
                        h(TabsTrigger, { value: 'b' }, () => 'B'),
                    ]),
                    h(TabsContent, { value: 'a' }, () => 'Panel A'),
                    h(TabsContent, { value: 'b' }, () => 'Panel B'),
                ],
            },
        });

        expect(wrapper.text()).toContain('Panel A');
        expect(wrapper.text()).not.toContain('Panel B');
    });
});
