import { can, type AppModule, type PermMap } from "@/lib/permissions";

export type NavIcon =
  | "overview" | "finances" | "transactions" | "payments" | "streams" | "marketing"
  | "calendar" | "tasks" | "chat" | "team" | "settings" | "audit";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** shown if the user can view any of these modules */
  modules: AppModule[];
  /** placeholder text shown on the top-bar search for this page */
  search: string;
  group: "workspace" | "admin";
};

export const NAV: NavItem[] = [
  { href: "/home", label: "Overview", icon: "overview", modules: ["home"], search: "Search clients, invoices, tasks", group: "workspace" },
  { href: "/analytics", label: "Finances", icon: "finances", modules: ["finances"], search: "Search reports, clients, streams", group: "workspace" },
  { href: "/transactions", label: "Transactions", icon: "transactions", modules: ["transactions"], search: "Search income and expenses", group: "workspace" },
  { href: "/payments", label: "Payments", icon: "payments", modules: ["payments"], search: "Search payments and subscriptions", group: "workspace" },
  { href: "/streams", label: "Revenue streams", icon: "streams", modules: ["streams", "countries", "representatives"], search: "Search streams, countries, representatives", group: "workspace" },
  { href: "/marketing", label: "Marketing", icon: "marketing", modules: ["marketing"], search: "Search campaigns, leads, channels", group: "workspace" },
  { href: "/calendar", label: "Calendar", icon: "calendar", modules: ["calendar"], search: "Search meetings, tasks, messages", group: "workspace" },
  { href: "/tasks", label: "Tasks", icon: "tasks", modules: ["tasks"], search: "Search tasks", group: "workspace" },
  { href: "/chat", label: "Team chat", icon: "chat", modules: ["chat"], search: "Search messages", group: "workspace" },
  { href: "/team", label: "Team & permissions", icon: "team", modules: ["team"], search: "Search people", group: "admin" },
  { href: "/settings", label: "Settings", icon: "settings", modules: ["settings"], search: "Search settings", group: "admin" },
  { href: "/audit", label: "Audit log", icon: "audit", modules: ["audit"], search: "Search the audit log", group: "admin" },
];

export function visibleNav(perms: PermMap): NavItem[] {
  return NAV.filter((n) => n.modules.some((m) => can(perms, m, "view")));
}

/** Pages that exist in the nav but are built in later phases. */
export const COMING_SOON: Record<string, { title: string; phase: number; blurb: string; module: AppModule }> = {
};
