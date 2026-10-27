import { redirect } from "next/navigation";
import { ListEditor } from "@/components/settings/ListEditor";
import { TimezoneForm } from "@/components/settings/TimezoneForm";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePerm } from "@/lib/auth/session";
import { settingsLists } from "@/lib/dal/lists";
import { getCompanySettings, timeZones } from "@/lib/dal/settings";
import { deleteListItem, saveListItem, saveTimezone, setListItemActive } from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requirePerm("settings");
  if (!actor.isAdmin) redirect("/no-access?module=settings");
  const [l, company] = await Promise.all([settingsLists(actor), getCompanySettings(actor)]);
  const actions = { save: saveListItem, toggle: setListItemActive, remove: deleteListItem };

  return (
    <>
      <PageHeader title="Settings" subtitle="Company settings and lists · admin only · every change is in the audit log" />
      <div className="grid grid-cols-1 gap-cards @min-[60rem]:grid-cols-2">
        <Card className="@min-[60rem]:col-span-2">
          <CardHeader title="Time zone" subtitle="Used for “today” (due dates), calendar times and the marketing heatmap. Times are stored in UTC, so changing this doesn't alter any record." />
          <div className="max-w-xl">
            <TimezoneForm current={company.timezone} zones={timeZones()} action={saveTimezone} />
          </div>
        </Card>
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
        <Card className="@min-[60rem]:col-span-2">
          <CardHeader title="Countries" subtitle="Used for income, expenses and payments. The code can't change once added; a country in use can't be deleted." />
          <ListEditor kind="country" items={l.countries} actions={actions} />
        </Card>
      </div>
      <p className="mt-4 text-sm text-muted">Company details, base currency and notification settings arrive with the rest of Settings in Phase 6.</p>
    </>
  );
}
