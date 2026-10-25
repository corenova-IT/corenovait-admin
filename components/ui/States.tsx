import { cx } from "./cx";

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      {icon && (
        <div className="grid size-12 place-items-center rounded-2xl border border-line bg-surface-2 text-accent-text">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      {children && <p className="max-w-md text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-xl bg-surface-2", className)} />;
}

export function ErrorState({ title = "Something went wrong", children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      <p className="max-w-md text-sm text-muted">{children ?? "Try again in a moment. If it keeps happening, tell an admin."}</p>
    </div>
  );
}
