import { z } from 'zod';

/** Shared result shapes (04 §0.4). */
export interface EngineMessage {
    code: string;
    messageKey: string;
    params: Record<string, string | number>;
}

/** Produced only by derivation; never saved (04 §0.4). */
export interface DeriveIssue extends EngineMessage {
    severity: 'warning' | 'info';
    entityIds: string[];
}

export type Result<T, E = EngineMessage> =
    { ok: true; value: T } | { ok: false; error: E };

/** Validation issue shared by plan and furniture validators (03 §3.1). */
export const IssueSchema = z.object({
    code: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    messageKey: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number()])),
    entityIds: z.array(z.string()),
});

export type Issue = z.infer<typeof IssueSchema>;
