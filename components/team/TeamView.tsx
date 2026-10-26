"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { IconPlus, IconUsers } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer, Modal } from "@/components/ui/Dialog";
import { Field, FormMessage, Input, Select } from "@/components/ui/Field";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/States";
import { permMapToPayload, type PermMap } from "@/lib/permissions";
import { PermissionMatrix } from "./PermissionMatrix";
import type { Action, Member, Preset, TeamActions, TeamState } from "./types";

const empty: TeamState = {};

function Msg({ state }: { state: TeamState }) {
  if (state.error) return <FormMessage tone="error">{state.error}</FormMessage>;
  if (state.ok) return <FormMessage tone="success">{state.ok}</FormMessage>;
  return null;
}

function statusBadge(m: Member) {
  if (m.status === "active" && m.lockedUntil) return <Badge tone="red">Locked</Badge>;
  if (m.status === "active") return <Badge tone="green">Active</Badge>;
  if (m.status === "invited") return <Badge tone="amber">Invite sent</Badge>;
  return <Badge tone="red">Deactivated</Badge>;
}

function mfaBadge(m: Member) {
  if (m.mfaEnabled) return <Badge tone="green">On</Badge>;
  if (m.mfaRequired) return <Badge tone="amber">Required, not set</Badge>;
  return <Badge>Off</Badge>;
}

// ---------- invite ----------
function InviteDrawer({ open, onClose, presets, action }: { open: boolean; onClose: () => void; presets: Preset[]; action: Action }) {
  const [state, formAction, pending] = useActionState(action, empty);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (state.ok) setFormKey((k) => k + 1);
  }, [state]);
  const e = state.fieldErrors ?? {};
  return (
    <Drawer open={open} onClose={onClose} title="Invite a person" description="They'll get an email to choose a password. New people get least-privilege access unless you pick another role.">
      <form key={formKey} action={formAction} className="flex flex-col gap-5" noValidate>
        <Msg state={state} />
        <Field label="Email" htmlFor="inv-email" error={e.email}>
          <Input id="inv-email" name="email" type="email" required autoComplete="off" invalid={!!e.email} aria-describedby={e.email ? "inv-email-error" : undefined} />
        </Field>
        <Field label="Full name" htmlFor="inv-name" error={e.fullName}>
          <Input id="inv-name" name="fullName" required invalid={!!e.fullName} aria-describedby={e.fullName ? "inv-name-error" : undefined} />
        </Field>
        <Field label="Job title" htmlFor="inv-title" hint="Optional, e.g. Web developer">
          <Input id="inv-title" name="jobTitle" />
        </Field>
        <Field label="Role" htmlFor="inv-role" error={e.presetId}>
          <Select id="inv-role" name="presetId" defaultValue="staff">
            {presets.filter((p) => p.id !== "custom").map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending invite…" : "Send invite"}
        </Button>
      </form>
    </Drawer>
  );
}

// ---------- manage one person ----------
function ManageDrawer({
  member,
  presets,
  actions,
  isSelf,
  onClose,
}: {
  member: Member | null;
  presets: Preset[];
  actions: TeamActions;
  isSelf: boolean;
  onClose: () => void;
}) {
  const [details, detailsAction, detailsPending] = useActionState(actions.saveDetails, empty);
  const [role, roleAction, rolePending] = useActionState(actions.applyPreset, empty);
  const [perms, permsAction, permsPending] = useActionState(actions.savePermissions, empty);
  const [access, accessAction, accessPending] = useActionState(actions.setActive, empty);
  const [sessions, sessionsAction, sessionsPending] = useActionState(actions.resetSessions, empty);
  const [invite, inviteAction, invitePending] = useActionState(actions.resendInvite, empty);
  const [mfa, mfaAction, mfaPending] = useActionState(actions.resetTwoFactor, empty);
  const [confirmMfa, setConfirmMfa] = useState(false);
  const [matrix, setMatrix] = useState<PermMap | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => setMatrix(member?.perms ?? null), [member]);
  if (!member || !matrix) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;
  const deactivating = member.status !== "deactivated";

  return (
    <Drawer open={!!member} onClose={onClose} wide title={member.name || member.email} description={member.email}>
      <div className="flex flex-col gap-8">
        <section aria-labelledby="mg-details">
          <h3 id="mg-details" className="label-mono mb-4">Details</h3>
          <form action={detailsAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="userId" value={member.id} />
            <Field label="Full name" htmlFor="mg-name" error={details.fieldErrors?.fullName}>
              <Input id="mg-name" name="fullName" defaultValue={member.name} required />
            </Field>
            <Field label="Job title" htmlFor="mg-title">
              <Input id="mg-title" name="jobTitle" defaultValue={member.jobTitle} />
            </Field>
            <div className="flex flex-col gap-3 sm:col-span-2">
              <Msg state={details} />
              <Button type="submit" variant="secondary" disabled={detailsPending} className="self-start">
                {detailsPending ? "Saving…" : "Save details"}
              </Button>
            </div>
          </form>
        </section>

        <section aria-labelledby="mg-role">
          <h3 id="mg-role" className="label-mono mb-4">Role preset</h3>
          <form action={roleAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="userId" value={member.id} />
            <Field label="Apply a preset" htmlFor="mg-preset" className="min-w-56 flex-1">
              <Select id="mg-preset" name="presetId" defaultValue={member.presetId === "custom" ? "staff" : member.presetId}>
                {presets.filter((p) => p.id !== "custom").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" disabled={rolePending}>
              {rolePending ? "Applying…" : "Apply preset"}
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            Currently: <strong className="text-ink-2">{presets.find((p) => p.id === member.presetId)?.name ?? member.presetId}</strong>. Applying a
            preset replaces their matrix below.
          </p>
          <div className="mt-3">
            <Msg state={role} />
          </div>
        </section>

        <section aria-labelledby="mg-perms">
          <h3 id="mg-perms" className="label-mono mb-4">Permissions</h3>
          <form action={permsAction} className="flex flex-col gap-4">
            <input type="hidden" name="userId" value={member.id} />
            <input type="hidden" name="perms" value={JSON.stringify(permMapToPayload(matrix))} />
            <PermissionMatrix value={matrix} onChange={setMatrix} idPrefix={`mg-${member.id}`} />
            <Msg state={perms} />
            <Button type="submit" disabled={permsPending} className="self-start">
              {permsPending ? "Saving…" : "Save as custom role"}
            </Button>
          </form>
        </section>

        <section aria-labelledby="mg-access" className="rounded-[18px] border border-line p-5">
          <h3 id="mg-access" className="label-mono mb-4">Access</h3>
          <div className="flex flex-wrap gap-3">
            <form action={sessionsAction}>
              <input type="hidden" name="userId" value={member.id} />
              <Button type="submit" variant="secondary" disabled={sessionsPending}>
                {sessionsPending ? "Ending sessions…" : "Reset sessions"}
              </Button>
            </form>
            {member.status === "invited" && (
              <form action={inviteAction}>
                <input type="hidden" name="userId" value={member.id} />
                <Button type="submit" variant="secondary" disabled={invitePending}>
                  {invitePending ? "Sending…" : "Resend invite"}
                </Button>
              </form>
            )}
            {!isSelf && member.mfaEnabled && (
              <Button variant="secondary" onClick={() => setConfirmMfa(true)}>
                Reset two-factor
              </Button>
            )}
            {!isSelf && (
              <Button variant={deactivating ? "danger" : "secondary"} onClick={() => setConfirmDeactivate(true)}>
                {deactivating ? "Deactivate account" : "Reactivate account"}
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            Reset sessions signs them out on every device. Reset two-factor is for a lost phone: they set up a new authenticator at their next sign-in. Deactivating blocks sign-in until you reactivate them; their records stay.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Msg state={sessions} />
            <Msg state={invite} />
            <Msg state={mfa} />
            <Msg state={access} />
          </div>
        </section>
      </div>

      <Modal
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        title={deactivating ? `Deactivate ${member.name || member.email}?` : `Reactivate ${member.name || member.email}?`}
        description={
          deactivating
            ? "They'll be signed out everywhere and won't be able to sign in. You can reactivate them later."
            : "They'll be able to sign in again with their existing password."
        }
      >
        <form action={accessAction} onSubmit={() => setConfirmDeactivate(false)} className="flex justify-end gap-3">
          <input type="hidden" name="userId" value={member.id} />
          <input type="hidden" name="active" value={deactivating ? "false" : "true"} />
          <Button variant="ghost" onClick={() => setConfirmDeactivate(false)}>
            Cancel
          </Button>
          <Button type="submit" variant={deactivating ? "danger" : "primary"} disabled={accessPending}>
            {deactivating ? "Deactivate" : "Reactivate"}
          </Button>
        </form>
      </Modal>

      <Modal
        open={confirmMfa}
        onClose={() => setConfirmMfa(false)}
        title={`Reset two-factor for ${member.name || member.email}?`}
        description="Only do this once you've confirmed it's really them, for example by phone. Their authenticator and recovery codes stop working, they're signed out, and they set up a new authenticator at their next sign-in."
      >
        <form action={mfaAction} onSubmit={() => setConfirmMfa(false)} className="flex justify-end gap-3">
          <input type="hidden" name="userId" value={member.id} />
          <Button variant="ghost" onClick={() => setConfirmMfa(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={mfaPending}>
            Reset two-factor
          </Button>
        </form>
      </Modal>
    </Drawer>
  );
}

// ---------- preset editor ----------
function PresetDrawer({ preset, action, onClose }: { preset: Preset | null; action: Action; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(action, empty);
  const [matrix, setMatrix] = useState<PermMap | null>(null);
  useEffect(() => setMatrix(preset?.perms ?? null), [preset]);
  if (!preset || !matrix) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;
  return (
    <Drawer
      open={!!preset}
      onClose={onClose}
      wide
      title={`Edit the ${preset.name} preset`}
      description={`Saving updates the ${preset.memberCount} ${preset.memberCount === 1 ? "person" : "people"} currently on this preset. People with a custom role aren't affected.`}
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="presetId" value={preset.id} />
        <input type="hidden" name="perms" value={JSON.stringify(permMapToPayload(matrix))} />
        <PermissionMatrix value={matrix} onChange={setMatrix} idPrefix={`pr-${preset.id}`} />
        <Msg state={state} />
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving…" : "Save preset"}
        </Button>
      </form>
    </Drawer>
  );
}

// ---------- page ----------
export function TeamView({
  members,
  presets,
  actions,
  canManage,
  currentUserId,
}: {
  members: Member[];
  presets: Preset[];
  actions: TeamActions;
  canManage: boolean;
  currentUserId: string;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);
  const [editingPreset, setEditingPreset] = useState<string | null>(null);
  const presetName = (id: string) => presets.find((p) => p.id === id)?.name ?? id;

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === "active");
    const needMfa = members.filter((m) => m.mfaRequired && m.status !== "deactivated");
    return {
      total: members.length,
      active: active.length,
      invited: members.filter((m) => m.status === "invited").length,
      admins: active.filter((m) => m.presetId === "admin").length,
      mfaOn: needMfa.filter((m) => m.mfaEnabled).length,
      mfaNeeded: needMfa.length,
    };
  }, [members]);

  const columns: Column<Member>[] = [
    {
      key: "person",
      header: "Person",
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={m.name || m.email} size={38} ring={m.id === currentUserId} />
          <div className="min-w-0">
            <p className="clamp-2 font-semibold text-ink">
              {m.name || "Unnamed"}
              {m.id === currentUserId && <span className="ml-2 font-mono text-xs font-normal text-muted">(you)</span>}
            </p>
            <p className="clamp-2 text-sm text-muted">{m.email}</p>
          </div>
        </div>
      ),
    },
    { key: "title", header: "Job title", hideBelow: "lg", cell: (m) => <span className="text-ink-2">{m.jobTitle || "—"}</span> },
    { key: "role", header: "Role", cell: (m) => <Badge tone={m.presetId === "admin" ? "red" : "neutral"}>{presetName(m.presetId)}</Badge> },
    { key: "status", header: "Status", hideBelow: "sm", cell: statusBadge },
    { key: "mfa", header: "Two-factor", hideBelow: "md", cell: mfaBadge },
    {
      key: "manage",
      header: "",
      align: "right",
      cell: (m) =>
        canManage ? (
          <Button size="sm" variant="secondary" onClick={() => setManaging(m.id)} aria-label={`Manage ${m.name || m.email}`}>
            Manage
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Team members" value={String(stats.total)} detail={`${stats.invited} invite${stats.invited === 1 ? "" : "s"} pending`} />
        <StatCard label="Active" value={String(stats.active)} detail="Can sign in now" />
        <StatCard label="Admins" value={String(stats.admins)} noteTone={stats.admins >= 2 ? "green" : "amber"} note={stats.admins >= 2 ? "Backup admin in place" : "Add a second admin"} />
        <StatCard
          label="Two-factor"
          value={`${stats.mfaOn}/${stats.mfaNeeded}`}
          noteTone={stats.mfaOn === stats.mfaNeeded ? "green" : "amber"}
          note={stats.mfaOn === stats.mfaNeeded ? "Everyone required is set up" : "Some required people aren't set up"}
        />
      </div>

      <Card>
        <CardHeader
          title="Team members"
          subtitle="Everyone with an account. Permissions are enforced by the database, not just hidden here."
          aside={
            canManage && (
              <Button onClick={() => setInviteOpen(true)}>
                <IconPlus size={18} /> Invite person
              </Button>
            )
          }
        />
        {members.length === 0 ? (
          <EmptyState icon={<IconUsers size={22} />} title="No one here yet">
            Invite your first team member to get started.
          </EmptyState>
        ) : (
          <DataTable caption="Team members" columns={columns} rows={members} rowKey={(m) => m.id} />
        )}
      </Card>

      <Card>
        <CardHeader title="Role presets" subtitle="Starting points for new people. Editing a preset updates everyone on it." />
        <ul className="flex flex-col">
          {presets.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-4 border-b border-line/70 py-4 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">
                  {p.name} <span className="ml-1 font-mono text-xs font-normal text-muted">{p.memberCount} {p.memberCount === 1 ? "person" : "people"}</span>
                </p>
                <p className="mt-0.5 text-sm text-muted">{p.description}</p>
              </div>
              {p.editable && canManage ? (
                <Button size="sm" variant="secondary" onClick={() => setEditingPreset(p.id)}>
                  Edit
                </Button>
              ) : (
                <Badge>{p.id === "custom" ? "Per person" : "Fixed"}</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {canManage && (
        <>
          <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} presets={presets} action={actions.inviteMember} />
          <ManageDrawer
            member={members.find((m) => m.id === managing) ?? null}
            presets={presets}
            actions={actions}
            isSelf={managing === currentUserId}
            onClose={() => setManaging(null)}
          />
          <PresetDrawer preset={presets.find((p) => p.id === editingPreset) ?? null} action={actions.savePreset} onClose={() => setEditingPreset(null)} />
        </>
      )}
    </div>
  );
}
