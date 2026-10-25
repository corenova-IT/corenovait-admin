import { SampleDataBadge } from "./Badge";

/** Big Bricolage title with the mono uppercase subtitle, as in every design page. */
export function PageHeader({
  title,
  subtitle,
  sample = false,
  actions,
}: {
  title: string;
  subtitle?: string;
  sample?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[40px] font-extrabold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[52px]">
          {title}
        </h1>
        {subtitle && <p className="label-mono mt-3 normal-case sm:uppercase">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {actions}
        {sample && <SampleDataBadge />}
      </div>
    </div>
  );
}
