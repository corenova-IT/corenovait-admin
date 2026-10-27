import type { NavItem } from "@/lib/nav";
import type { Theme } from "@/lib/theme";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { Badges } from "./badges";

export function PortalShell({
  nav,
  user,
  theme,
  badges,
  children,
}: {
  nav: NavItem[];
  user: { name: string; email: string; role: string };
  theme: Theme;
  badges: Badges;
  children: React.ReactNode;
}) {
  return (
    <div className="lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
      >
        Skip to content
      </a>
      <Sidebar items={nav} userName={user.name} userRole={user.role} badges={badges} />
      <div className="min-w-0 flex-1">
        <header className="px-4 pt-5 sm:px-8 sm:pt-7 lg:px-10">
          <Topbar name={user.name} email={user.email} theme={theme} badges={badges} />
        </header>
        {/* @container: page grids size their columns to the space next to the sidebar, not the window */}
        <main id="main" className="@container px-4 pb-16 pt-7 sm:px-8 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
