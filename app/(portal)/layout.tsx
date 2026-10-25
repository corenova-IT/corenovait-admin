import { cookies } from "next/headers";
import { PortalShell } from "@/components/layout/PortalShell";
import { requireUser } from "@/lib/auth/session";
import { visibleNav } from "@/lib/nav";
import { THEME_COOKIE } from "@/lib/theme";
import { createClient } from "@/lib/supabase/server";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: preset } = await supabase.from("role_presets").select("name").eq("id", user.profile.preset_id).maybeSingle();
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  const name = user.profile.full_name || user.profile.email;
  const role = [user.profile.job_title, preset?.name].filter(Boolean).join(" · ");

  return (
    <PortalShell nav={visibleNav(user.perms)} user={{ name, email: user.profile.email, role }} theme={theme}>
      {children}
    </PortalShell>
  );
}
