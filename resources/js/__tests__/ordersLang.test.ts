import { describe, expect, it } from 'vitest';
import en from '@/lang/generated/en.json';

const messages = en as Record<string, string>;

// 09 §1 "Label (en)" and "Customer sees as"; 15 §9.3 short labels. Typed out
// here on purpose: the lang file must match the spec, not itself.
const STATES: Record<string, [label: string, sentence: string, short: string]> =
    {
        draft: ['Draft', 'Draft — not sent yet', 'Draft'],
        submitted: ['Submitted', 'Waiting for review', 'Waiting for review'],
        in_review: [
            'In review',
            'Our team is reviewing your designs',
            'In review',
        ],
        changes_proposed: [
            'Changes proposed',
            'Action needed: review our suggested changes',
            'Action needed',
        ],
        quoted: [
            'Quote sent',
            'Action needed: review your quote',
            'Quote ready',
        ],
        negotiating: [
            'Negotiating',
            "We're reviewing your response",
            'Under discussion',
        ],
        accepted: [
            'Quote accepted',
            "Accepted — we'll call you to confirm",
            'Accepted',
        ],
        confirmed: [
            'Confirmed',
            'Confirmed — production will start soon',
            'Confirmed',
        ],
        in_production: ['In production', 'In production', 'In production'],
        completed: [
            'Completed — awaiting your check',
            'Action needed: check the photos of your furniture',
            'Check your furniture',
        ],
        rework: [
            'Rework',
            "We're fixing the issue you reported",
            'Fixing an issue',
        ],
        ready_for_delivery: [
            'Ready for delivery',
            'Ready for delivery',
            'Ready for delivery',
        ],
        delivered: ['Delivered', 'Delivered', 'Delivered'],
        closed: ['Closed', 'Closed', 'Closed'],
        cancelled: ['Cancelled', 'Cancelled', 'Cancelled'],
        on_hold: ['On hold', 'On hold', 'On hold'],
    };

describe('orders.states* strings (48)', () => {
    it('cover exactly the 16 states in each of the three groups', () => {
        for (const group of [
            'orders.states',
            'orders.states_customer',
            'orders.states_customer_short',
        ]) {
            const keys = Object.keys(messages)
                .filter((key) => key.startsWith(`${group}.`))
                .map((key) => key.slice(group.length + 1))
                .sort();

            expect(keys, group).toEqual(Object.keys(STATES).sort());
        }
    });

    it.each(Object.entries(STATES))('%s', (state, [label, sentence, short]) => {
        expect(messages[`orders.states.${state}`]).toBe(label);
        expect(messages[`orders.states_customer.${state}`]).toBe(sentence);
        expect(messages[`orders.states_customer_short.${state}`]).toBe(short);
    });
});
