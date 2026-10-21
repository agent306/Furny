import type { IconName } from '@/lib/icons';
import type {
    ChangeProposalStatus,
    ImportStatus,
    IssueStatus,
    NegotiationStatus,
    OrderStateKey,
    ProposalItemDecision,
    QuoteStatus,
} from '@/types/domain';
import type { Tone } from '@/types/ui';

// Status → tone (and icon) tables of 15 §9.3. `Record<Enum, …>` makes a new
// backend enum value a compile error here. Tones are always shown with a text
// label and, for orders, an icon: colour is never the only signal (15 §14.10).

export const ORDER_STATE_TONE: Record<OrderStateKey, Tone> = {
    draft: 'neutral',
    submitted: 'info',
    in_review: 'info',
    changes_proposed: 'warning',
    quoted: 'warning',
    negotiating: 'info',
    accepted: 'primary',
    confirmed: 'success',
    in_production: 'primary',
    completed: 'warning',
    rework: 'warning',
    ready_for_delivery: 'success',
    delivered: 'success',
    closed: 'neutral',
    cancelled: 'danger',
    on_hold: 'warning',
};

/** Registry names (`lib/icons.ts`); `cancelled` is lucide `circle-x`, registered as `x-circle`. */
export const ORDER_STATE_ICON: Record<OrderStateKey, IconName> = {
    draft: 'file-pen',
    submitted: 'send',
    in_review: 'search',
    changes_proposed: 'git-compare',
    quoted: 'receipt',
    negotiating: 'messages-square',
    accepted: 'handshake',
    confirmed: 'badge-check',
    in_production: 'hammer',
    completed: 'camera',
    rework: 'wrench',
    ready_for_delivery: 'truck',
    delivered: 'package-check',
    closed: 'archive',
    cancelled: 'x-circle',
    on_hold: 'pause-circle',
};

export const IMPORT_STATUS_TONE: Record<ImportStatus, Tone> = {
    uploaded: 'info',
    queued: 'info',
    preprocessing: 'info',
    recognizing: 'info',
    ready_for_review: 'warning',
    accepted: 'success',
    discarded: 'neutral',
    failed: 'danger',
    cancelled: 'neutral',
};

export const QUOTE_STATUS_TONE: Record<QuoteStatus, Tone> = {
    draft: 'neutral',
    sent: 'warning',
    accepted: 'success',
    declined: 'danger',
    superseded: 'neutral',
    expired: 'neutral',
    withdrawn: 'neutral',
};

export const PROPOSAL_STATUS_TONE: Record<ChangeProposalStatus, Tone> = {
    draft: 'neutral',
    sent: 'warning',
    resolved: 'success',
    withdrawn: 'neutral',
};

export const PROPOSAL_DECISION_TONE: Record<ProposalItemDecision, Tone> = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
};

export const ISSUE_STATUS_TONE: Record<IssueStatus, Tone> = {
    open: 'danger',
    in_progress: 'warning',
    resolved: 'success',
    rejected: 'neutral',
};

export const NEGOTIATION_STATUS_TONE: Record<NegotiationStatus, Tone> = {
    open: 'warning',
    answered_with_revision: 'info',
    answered_keep_price: 'info',
    closed: 'neutral',
};
