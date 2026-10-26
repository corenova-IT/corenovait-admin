import { redirect } from "next/navigation";
import { ListEditor } from "@/components/settings/ListEditor";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePerm } from "@/lib/auth/session";
import { settingsLists } from "@/lib/dal/lists";
import { deleteListItem, saveListItem, setListItemActive } from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requirePerm("settings");
  if (!actor.isAdmin) redirect("/no-access?module=settings");
  const l = await settingsLists(actor);
  const actions = { save: saveListItem, toggle: setListItemActive, remove: deleteListItem };

  return (
    <>
      <PageHeader title="Settings" subtitle="Lists used across the portal · admin only · every change is in the audit log" />
      <div className="grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-2">
        <Card>
          <CardHeader
            title="Revenue streams"
            subtitle="Where income comes from. Streams in use can be renamed or archived (hidden from new entries), not deleted."
          />
          <ListEditor kind="stream" items={l.streams} actions={actions} />
        </Card>
        <Card>
          <CardHeader title="Expense categories" subtitle="Renaming a category updates every expense and payment that uses it. Archive to stop new use." />
          <ListEditor kind="category" items={l.categories} actions={actions} />
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Countries" subtitle="Used for income, expenses and payments. The code can't change once added; a country in use can't be deleted." />
          <ListEditor kind="country" items={l.countries} actions={actions} />
        </Card>
      </div>
      <p className="mt-4 text-sm text-muted">Company details, base currency, time zone and notification settings arrive with the rest of Settings in Phase 6.</p>
    </>
  );
}
