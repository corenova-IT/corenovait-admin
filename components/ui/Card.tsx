import { cx } from "./cx";

export function Card({
  children,
  className,
  glow = false,
  accent = false,
  as: Tag = "section",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  accent?: boolean;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    // min-w-0: inside a grid, let wide content (tables) scroll within the card instead of widening the page
    <Tag className={cx("glass min-w-0 p-6 sm:p-7", glow && "glass-glow", accent && "glass-accent", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  aside,
  subtitle,
  id,
}: {
  title: string;
  aside?: React.ReactNode;
  subtitle?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 id={id} className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}
