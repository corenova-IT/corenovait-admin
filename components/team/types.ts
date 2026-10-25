import type { PermMap } from "@/lib/permissions";

export type MemberStatus = "active" | "invited" | "deactivated";

export type Member = {
  id: string;
  email: string;
  name: string;
  jobTitle: string;
  presetId: string;
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

export type TeamActions = {
  inviteMember: Action;
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
