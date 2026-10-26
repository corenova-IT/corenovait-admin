import { RevenueTabs } from "@/components/revenue/RevenueTabs";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/dal/guard";

/** Shared frame for Streams, Countries and Representatives. Each page checks its own permission. */
export default async function RevenueLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const visible = (["streams", "countries", "representatives"] as const).filter((m) => hasPerm(actor, m, "view"));
  return (
    <>
      <RevenueTabs visible={[...visible]} />
      {children}
    </>
  );
}
