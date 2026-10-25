import { notFound } from "next/navigation";
import { NavIcon } from "@/components/layout/NavIcon";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requireUser } from "@/lib/auth/session";
import { COMING_SOON, NAV } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";

/** Placeholder for pages built in later phases. Still permission-guarded. */
export default async function ComingSoonPage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const info = COMING_SOON[module];
  if (!info) notFound();
  const user = await requireUser();
  const nav = NAV.find((n) => n.href === `/${module}`);
  const allowed = nav ? nav.modules.some((m) => can(user.perms, m)) : can(user.perms, info.module);
  if (!allowed) redirect(`/no-access?module=${info.module}`);

  return (
    <>
      <PageHeader title={info.title} />
      <Card>
        <EmptyState icon={nav ? <NavIcon name={nav.icon} size={22} /> : undefined} title={`Built in Phase ${info.phase}`}>
          {info.blurb}
        </EmptyState>
      </Card>
    </>
  );
}
