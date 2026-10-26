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
    <Tag className={cx("glass min-w-0 card-pad", glow && "glass-glow", accent && "glass-accent", className)} {...rest}>
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
    // the aside (badge, toggle, link) wraps under the title when there isn't room, so it never squeezes it
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-[1_1_12rem]">
        <h2 id={id} className="title-card font-bold tracking-[-0.02em] text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {aside && <div className="flex max-w-full flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}
