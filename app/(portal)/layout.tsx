import { cookies } from "next/headers";
import { PortalShell } from "@/components/layout/PortalShell";
import { requireUser } from "@/lib/auth/session";
import { visibleNav } from "@/lib/nav";
import { THEME_COOKIE } from "@/lib/theme";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  const name = actor.fullName || actor.email;
  const role = [actor.jobTitle, actor.presetName].filter(Boolean).join(" · ");

  return (
    <PortalShell nav={visibleNav(actor.perms)} user={{ name, email: actor.email, role }} theme={theme}>
      {children}
    </PortalShell>
  );
}
