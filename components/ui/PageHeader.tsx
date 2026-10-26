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
    <div className="mb-[calc(var(--space-gap)*1.5)] flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-[1_1_18rem]">
        <h1 className="font-display text-[clamp(2rem,1.4rem+2vw,3.25rem)] font-extrabold leading-[1.05] tracking-[-0.035em] text-balance text-ink">
          {title}
        </h1>
        {subtitle && <p className="label-mono mt-3 normal-case sm:uppercase">{subtitle}</p>}
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-3">
        {actions}
        {sample && <SampleDataBadge />}
      </div>
    </div>
  );
}
