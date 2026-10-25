import { IconLock } from "@/components/icons";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { requireUser } from "@/lib/auth/session";
import { MODULE_LABELS, MODULES, can, type AppModule } from "@/lib/permissions";

export const metadata = { title: "No access" };

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const user = await requireUser();
  const { module } = await searchParams;
  const label = MODULES.includes(module as AppModule) ? MODULE_LABELS[module as AppModule] : "that page";
  return (
    <Card className="mx-auto mt-10 max-w-xl">
      <EmptyState
        icon={<IconLock size={22} />}
        title="You don't have access to this"
        action={can(user.perms, "home") ? <ButtonLink href="/home" variant="secondary">Back to home</ButtonLink> : undefined}
      >
        Your account can't open {label}. If you need it for your work, ask an admin to add it to your permissions.
      </EmptyState>
    </Card>
  );
}
