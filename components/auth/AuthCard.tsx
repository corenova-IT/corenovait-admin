export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="glass glass-glow p-7 sm:p-9" aria-labelledby="auth-title">
      <h1 id="auth-title" className="font-display text-[30px] font-extrabold tracking-[-0.03em] text-ink">
        {title}
      </h1>
      {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
      <div className="mt-7">{children}</div>
    </section>
  );
}
