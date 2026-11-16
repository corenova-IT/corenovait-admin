import { RevenueTabs } from "@/components/revenue/RevenueTabs";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/dal/guard";

/** Shared frame for Streams, Countries, Representatives and (owner only) Projects. Each page checks its own permission. */
export default async function RevenueLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const visible: Array<"streams" | "countries" | "representatives" | "projects"> = (["streams", "countries", "representatives"] as const).filter((m) => hasPerm(actor, m, "view"));
  if (actor.isOwner) visible.push("projects");
  return (
    <>
      <RevenueTabs visible={visible} />
      {children}
    </>
  );
}
