import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICONS } from '@/lib/icons';
import {
    IMPORT_STATUS_TONE,
    ISSUE_STATUS_TONE,
    NEGOTIATION_STATUS_TONE,
    ORDER_STATE_ICON,
    ORDER_STATE_TONE,
    PROPOSAL_DECISION_TONE,
    PROPOSAL_STATUS_TONE,
    QUOTE_STATUS_TONE,
} from '@/lib/statusTones';

const declarations = readFileSync('resources/js/types/generated.d.ts', 'utf8');

function members(typeName: string): string[] {
    const match = new RegExp(
        `type ${typeName}\\s*=\\s*((?:\\s*\\|?\\s*'[^']*')+)`,
    ).exec(declarations);

    return [...(match?.[1] ?? '').matchAll(/'([^']*)'/g)].map(
        (member) => member[1] ?? '',
    );
}

describe('status tone tables (15 §9.3)', () => {
    it.each([
        ['OrderStateKey', ORDER_STATE_TONE],
        ['OrderStateKey', ORDER_STATE_ICON],
        ['ImportStatus', IMPORT_STATUS_TONE],
        ['QuoteStatus', QUOTE_STATUS_TONE],
        ['ChangeProposalStatus', PROPOSAL_STATUS_TONE],
        ['ProposalItemDecision', PROPOSAL_DECISION_TONE],
        ['IssueStatus', ISSUE_STATUS_TONE],
        ['NegotiationStatus', NEGOTIATION_STATUS_TONE],
    ])('%s: a table has exactly one entry per enum value', (type, table) => {
        expect(members(type).length).toBeGreaterThan(2);
        expect(Object.keys(table).sort()).toEqual(members(type).sort());
    });

    it('only uses the six tones', () => {
        const tones = new Set([
            ...Object.values(ORDER_STATE_TONE),
            ...Object.values(IMPORT_STATUS_TONE),
            ...Object.values(QUOTE_STATUS_TONE),
            ...Object.values(PROPOSAL_STATUS_TONE),
            ...Object.values(PROPOSAL_DECISION_TONE),
            ...Object.values(ISSUE_STATUS_TONE),
            ...Object.values(NEGOTIATION_STATUS_TONE),
        ]);

        expect([...tones].sort()).toEqual([
            'danger',
            'info',
            'neutral',
            'primary',
            'success',
            'warning',
        ]);
    });

    it('gives every order state an icon from the registry, one icon each', () => {
        const icons = Object.values(ORDER_STATE_ICON);

        for (const icon of icons) {
            expect(ICONS[icon], icon).toBeDefined();
        }

        expect(new Set(icons).size).toBe(icons.length);
    });
});
