// Short names for the generated enum unions (`types/generated.d.ts` declares
// them in the global `App.Domain.*` namespaces). Add an alias when a component
// first needs an enum.
export type OrderStateKey = App.Domain.Orders.Enums.OrderStateKey;
export type ImportStatus = App.Domain.Imports.Enums.ImportStatus;
export type QuoteStatus = App.Domain.Orders.Enums.QuoteStatus;
export type ChangeProposalStatus = App.Domain.Orders.Enums.ChangeProposalStatus;
export type ProposalItemDecision = App.Domain.Orders.Enums.ProposalItemDecision;
export type IssueStatus = App.Domain.Orders.Enums.IssueStatus;
export type NegotiationStatus = App.Domain.Orders.Enums.NegotiationStatus;

export type StaffRole = App.Domain.Identity.Enums.StaffRole;
export type StaffRowData = App.Domain.Identity.Data.StaffRowData;
export type StaffInvitationRowData =
    App.Domain.Identity.Data.StaffInvitationRowData;

/** A role as the staff page offers it (11 §7): translated label and description, and whether the viewer may give it. */
export type StaffRoleOption = {
    name: StaffRole;
    label: string;
    description: string;
    assignable: boolean;
};

export type MediaData = App.Domain.Shared.Data.MediaData;
export type UploadPurpose = App.Domain.Shared.Enums.UploadPurpose;

export type AuthUserData = App.Domain.Identity.Data.AuthUserData;
export type SessionData = App.Domain.Identity.Data.SessionData;
export type ActiveOrderRefData = App.Domain.Identity.Data.ActiveOrderRefData;
export type OtpChannel = App.Domain.Identity.Enums.OtpChannel;
export type UnitSystem = App.Domain.Identity.Enums.UnitSystem;
export type LengthUnit = App.Domain.Identity.Enums.LengthUnit;
