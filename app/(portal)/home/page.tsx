import { IconOverview } from "@/components/icons";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { ButtonLink } from "@/components/ui/Button";
import { requirePerm } from "@/lib/auth/session";
import { hasSampleData } from "@/lib/dal/finance";
import { can } from "@/lib/permissions";

export const metadata = { title: "Overview" };

export default async function HomePage() {
  const user = await requirePerm("home");
  const first = (user.fullName || "there").split(" ")[0];
  const financeAccess = can(user.perms, "finances");
  const sample = await hasSampleData(user);

  return (
    <>
      <PageHeader
        title={financeAccess ? "Overview" : `Hello, ${first}`}
        subtitle={financeAccess ? "Company finances · reported in AUD" : "Your day at CoreNovaIT"}
        sample={sample}
      />
      <Card>
        <EmptyState
          icon={<IconOverview size={22} />}
          title={financeAccess ? "The finance overview arrives in Phase 2" : "Your “My Day” page arrives in Phase 4"}
          action={
            user.isAdmin ? (
              <ButtonLink href="/team" variant="secondary">
                Manage the team
              </ButtonLink>
            ) : undefined
          }
        >
          {financeAccess
            ? "Revenue, net profit, expenses and upcoming payments, the revenue vs expenses vs profit chart, revenue by stream and country, and the upcoming subscriptions list will appear here once income and expenses can be recorded. Every figure will come from the database."
            : "Today's meetings, the tasks due for you, unread chat and quick actions will appear here."}
        </EmptyState>
      </Card>
    </>
  );
}
