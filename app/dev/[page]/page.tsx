import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AuditTable } from "@/components/audit/AuditTable";
import { AuthCard } from "@/components/auth/AuthCard";
import { Logo } from "@/components/layout/Logo";
import { PortalShell } from "@/components/layout/PortalShell";
import { TeamView } from "@/components/team/TeamView";
import { Badge, DeltaBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, FormMessage, Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill, PillSwitch } from "@/components/ui/Pill";
import { EmptyState, Skeleton } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { THEME_COOKIE } from "@/lib/theme";
import { previewAudit, previewMembers, previewNav, previewPresets } from "../fixtures";
import { previewAction } from "../preview-actions";

/**
 * DEVELOPMENT ONLY design preview, so the UI can be reviewed before a
 * database is connected. Returns 404 in production builds.
 * Every name, email and number here is fake.
 */
export default async function DevPreview({ params }: { params: Promise<{ page: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { page } = await params;
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  const shell = (children: React.ReactNode) => (
    <PortalShell nav={previewNav} user={{ name: "Alex Example", email: "admin.one@example.test", role: "Co-founder · Admin" }} theme={theme} unread={3}>
      {children}
    </PortalShell>
  );

  if (page === "login") {
    return (
      <main className="grid min-h-dvh place-items-center px-4 py-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex justify-center"><Logo /></div>
          <AuthCard title="Sign in" subtitle="Use the email your admin invited.">
            <div className="flex flex-col gap-5">
              <FormMessage tone="info">You were signed out after 30 minutes without activity.</FormMessage>
              <Field label="Email" htmlFor="e"><Input id="e" type="email" placeholder="you@corenovait.com.au" /></Field>
              <Field label="Password" htmlFor="p"><Input id="p" type="password" defaultValue="placeholder" /></Field>
              <Button>Sign in</Button>
              <span className="self-center text-sm text-accent-text">Forgot your password?</span>
            </div>
          </AuthCard>
        </div>
      </main>
    );
  }

  if (page === "team") {
    return shell(
      <>
        <PageHeader title="Team and permissions" subtitle="6 people · 14 modules · admin only" sample />
        <TeamView
          members={previewMembers}
          presets={previewPresets}
          canManage
          currentUserId={previewMembers[0].id}
          actions={{ inviteMember: previewAction, resendInvite: previewAction, resetTwoFactor: previewAction, saveDetails: previewAction, applyPreset: previewAction, savePermissions: previewAction, setActive: previewAction, resetSessions: previewAction, savePreset: previewAction }}
        />
      </>
    );
  }

  if (page === "audit") {
    return shell(
      <>
        <PageHeader title="Audit log" subtitle="Read-only · every create, change, delete and export · times in Australia/Sydney" sample />
        <Card><AuditTable rows={previewAudit} timeZone="Australia/Sydney" /></Card>
      </>
    );
  }

  if (page === "ui") {
    return shell(
      <>
        <PageHeader title="Overview" subtitle="Company finances · last 12 months · reported in AUD" sample actions={<PillSwitch label="Country" value="all" options={[{ value: "all", label: "All", href: "#" }, { value: "uk", label: "UK", href: "#" }, { value: "aus", label: "AUS", href: "#" }]} />} />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total revenue" value="A$694,000" note="+18.2%" noteTone="green" detail="All countries · vs prior year" trend={[3, 4, 3.6, 5, 4.8, 6, 6.4, 7]} />
          <StatCard label="Net profit" value="A$348,000" note="+22.4%" noteTone="green" detail="All countries · vs prior year" trend={[2, 2.4, 2.2, 3, 3.4, 3.2, 4, 4.4]} />
          <StatCard label="Total expenses" value="A$346,000" note="+9.1%" noteTone="amber" detail="All countries · vs prior year" trend={[3, 3.2, 3.1, 3.3, 3.2, 3.4, 3.3, 3.5]} />
          <StatCard label="Upcoming payments" value="A$14,860" note="6 payments due" noteTone="amber" detail="Next 30 days" trend={[5, 4, 5.5, 4.2, 4.8, 3.6, 4.4, 3.8]} />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Badges and pills" aside={<Pill>UK + AUS = 90%</Pill>} />
            <div className="flex flex-wrap gap-2">
              <Badge>Neutral</Badge><Badge tone="red">Meeting</Badge><Badge tone="green">Paid</Badge><Badge tone="amber">in 3 days</Badge><DeltaBadge value={12.56} /><DeltaBadge value={-4.1} />
            </div>
            <div className="mt-5 flex flex-wrap gap-3"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button></div>
          </Card>
          <Card>
            <CardHeader title="Loading and empty states" />
            <div className="flex flex-col gap-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24" /></div>
            <EmptyState title="Nothing here yet">Empty states explain what will appear and how to add it.</EmptyState>
          </Card>
        </div>
      </>
    );
  }

  notFound();
}
