import { cx } from "./cx";

const control =
  "w-full rounded-[14px] border border-line bg-input px-4 text-[15px] text-ink placeholder:text-muted transition-colors hover:border-ink-2/40 focus-visible:border-accent-line aria-[invalid=true]:border-accent-line";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm text-accent-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cx(control, "h-12", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({
  className,
  invalid,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={cx(control, "h-12 appearance-none pr-10", className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(control, "min-h-28 py-3", className)} {...rest} />;
}

/** Form-level message: success or a plain-language error. */
export function FormMessage({ tone, children }: { tone: "error" | "success" | "info"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-[14px] border px-4 py-3 text-sm",
        tone === "error" && "border-accent-line bg-accent-soft text-ink",
        tone === "success" && "border-success/40 bg-success-soft text-ink",
        tone === "info" && "border-line bg-surface-2 text-ink-2"
      )}
    >
      {children}
    </div>
  );
}
