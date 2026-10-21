type Attrs = Record<string, unknown>;

/**
 * What belongs on the wrapper of a component that wraps an `<input>`
 * (`inheritAttrs: false`): the caller's `class` and `style`.
 */
export function rootAttrs(attrs: Attrs): Attrs {
    return { class: attrs.class, style: attrs.style };
}

/**
 * Attributes for the `<input>` inside such a component: everything the caller
 * passed except `class` and `style`. The caller's `aria-describedby` (a hint,
 * say) is kept and the component's own ids (its error message) are appended.
 */
export function inputAttrs(
    attrs: Attrs,
    ...ownDescribedBy: (string | undefined)[]
): Attrs {
    const rest = Object.fromEntries(
        Object.entries(attrs).filter(
            ([name]) => name !== 'class' && name !== 'style',
        ),
    );
    const describedBy = [rest['aria-describedby'], ...ownDescribedBy]
        .filter(
            (id): id is string => typeof id === 'string' && id.trim() !== '',
        )
        .join(' ');

    return { ...rest, 'aria-describedby': describedBy || undefined };
}
