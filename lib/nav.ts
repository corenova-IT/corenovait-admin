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
  analytics: { title: "Finances", phase: 2, module: "finances", blurb: "Revenue, expenses and profit trends, margins, stream and country breakdowns, and CSV export." },
  payments: { title: "Payments and subscriptions", phase: 2, module: "payments", blurb: "Upcoming payments for 30, 60 and 90 days, recurring totals and reminders." },
  marketing: { title: "Marketing", phase: 3, module: "marketing", blurb: "Channel performance, deals won by month, the response heatmap and the activity log." },
  calendar: { title: "Calendar", phase: 4, module: "calendar", blurb: "Month, week and agenda views for meetings, deadlines and payment dates." },
  tasks: { title: "Tasks", phase: 4, module: "tasks", blurb: "Board and list views, per-employee to-do lists, checklists and comments." },
  chat: { title: "Team chat", phase: 5, module: "chat", blurb: "Realtime channels and direct messages with unread counts and attachments." },
  settings: { title: "Settings", phase: 2, module: "settings", blurb: "Company profile, base currency, timezone, lists, exchange-rate defaults and notifications." },
};
