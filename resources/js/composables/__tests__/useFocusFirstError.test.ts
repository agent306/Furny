import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { useFocusFirstError } from '@/composables/useFocusFirstError';

afterEach(() => {
    document.body.innerHTML = '';
});

function form() {
    return mount(
        defineComponent({
            setup() {
                const invalid = ref<string[]>([]);
                const { focusFirstError } = useFocusFirstError();

                return () =>
                    h('form', [
                        ...['a', 'b', 'c'].map((id) =>
                            h('input', {
                                id,
                                'aria-invalid': invalid.value.includes(id)
                                    ? 'true'
                                    : undefined,
                            }),
                        ),
                        h('button', {
                            id: 'fail',
                            type: 'button',
                            onClick: () => {
                                invalid.value = ['b', 'c'];
                                void focusFirstError();
                            },
                        }),
                    ]);
            },
        }),
        { attachTo: document.body },
    );
}

describe('useFocusFirstError (15 §10.1)', () => {
    it('focuses the first field marked invalid once the marks are rendered', async () => {
        const wrapper = form();

        await wrapper.get('#fail').trigger('click');
        await nextTick();

        expect(document.activeElement?.id).toBe('b');
    });

    it('leaves the focus alone when no field is invalid', async () => {
        const wrapper = form();
        const button = wrapper.get<HTMLButtonElement>('#fail').element;
        const { focusFirstError } = useFocusFirstError();

        button.focus();
        await focusFirstError();

        expect(document.activeElement).toBe(button);
    });

    it('searches only the root it is given', async () => {
        const wrapper = form();
        const outside = document.createElement('input');
        outside.setAttribute('aria-invalid', 'true');
        document.body.prepend(outside);
        const { focusFirstError } = useFocusFirstError(() => wrapper.element);

        await wrapper.get('#fail').trigger('click');
        await focusFirstError();

        expect(document.activeElement?.id).toBe('b');
    });
});
