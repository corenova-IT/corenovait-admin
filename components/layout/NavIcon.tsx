import {
  IconCalendar, IconCard, IconChat, IconDollar, IconMegaphone, IconOverview, IconReceipt,
  IconSettings, IconShield, IconTasks, IconTrend, IconUsers,
} from "@/components/icons";
import type { NavIcon as NavIconName } from "@/lib/nav";

const map = {
  overview: IconOverview,
  finances: IconDollar,
  transactions: IconReceipt,
  payments: IconCard,
  streams: IconTrend,
  marketing: IconMegaphone,
  calendar: IconCalendar,
  tasks: IconTasks,
  chat: IconChat,
  team: IconUsers,
  settings: IconSettings,
  audit: IconShield,
} satisfies Record<NavIconName, unknown>;

export function NavIcon({ name, size = 18 }: { name: NavIconName; size?: number }) {
  const Icon = map[name];
  return <Icon size={size} />;
}
