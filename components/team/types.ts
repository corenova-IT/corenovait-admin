import type { PermMap } from "@/lib/permissions";

export type MemberStatus = "active" | "invited" | "deactivated";

export type Member = {
  id: string;
  email: string;
  name: string;
  jobTitle: string;
  /** profile picture, or null for initials */
  avatarUrl: string | null;
  presetId: string;
  /** the one main admin, who sees all revenue (see Projects under Revenue streams) */
  isOwner: boolean;
  status: MemberStatus;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  /** set while the account is locked after too many wrong passwords */
  lockedUntil: string | null;
  lastSignIn: string | null;
  perms: PermMap;
};

export type Preset = {
  id: string;
  name: string;
  description: string;
  perms: PermMap;
  editable: boolean;
  memberCount: number;
};

/** Streams and countries a stream partner can be given (a stream shows who it already belongs to). */
export type AssignmentOptions = {
  streams: Array<{ id: number; name: string; active: boolean; partnerUserId: string | null; partnerName: string | null }>;
  countries: Array<{ code: string; name: string }>;
};
export type PartnerAssignment = { streamIds: number[]; countryCodes: string[] };

export type TeamActions = {
  inviteMember: Action;
  saveAssignments: Action;
  resendInvite: Action;
  saveDetails: Action;
  applyPreset: Action;
  savePermissions: Action;
  setActive: Action;
  resetSessions: Action;
  resetTwoFactor: Action;
  savePreset: Action;
};

export type TeamState = { ok?: string; error?: string; fieldErrors?: Record<string, string> };
export type Action = (prev: TeamState, formData: FormData) => Promise<TeamState>;
