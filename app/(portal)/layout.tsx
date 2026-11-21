import { cookies } from "next/headers";
import { PortalShell } from "@/components/layout/PortalShell";
import { requireUser } from "@/lib/auth/session";
import { touchPresence, unreadChatTotal } from "@/lib/dal/chat";
import { unreadNotificationCount } from "@/lib/dal/notifications";
import { visibleNav } from "@/lib/nav";
import { THEME_COOKIE } from "@/lib/theme";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  const name = actor.fullName || actor.email;
  const role = [actor.jobTitle, actor.presetName].filter(Boolean).join(" · ");

  // partners and employees have no chat screen yet: keep their "online" dot fresh as they move around
  if (actor.scoped) await touchPresence(actor);
  const [notifications, chat] = await Promise.all([unreadNotificationCount(actor), unreadChatTotal(actor)]);
  return (
    <PortalShell nav={visibleNav(actor.perms)} user={{ name, email: actor.email, role, avatarUrl: actor.avatarUrl }} theme={theme} badges={{ notifications, chat }}>
      {children}
    </PortalShell>
  );
}
