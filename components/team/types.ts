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
  /** null when it couldn't be checked (service key not configured) */
  mfaEnabled: boolean | null;
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
  saveDetails: Action;
  applyPreset: Action;
  savePermissions: Action;
  setActive: Action;
  resetSessions: Action;
  savePreset: Action;
};

export type TeamState = { ok?: string; error?: string; fieldErrors?: Record<string, string> };
export type Action = (prev: TeamState, formData: FormData) => Promise<TeamState>;
