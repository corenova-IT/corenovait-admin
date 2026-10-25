/** The CoreNovaIT portal mark from the designs: red "C" tile + wordmark. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="btn-primary-glow grid size-9 place-items-center rounded-[11px] bg-accent font-display text-[17px] font-extrabold text-on-accent"
      >
        C
      </span>
      {!compact && (
        <span className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
          CoreNova<span className="text-accent-text">IT</span>
        </span>
      )}
      <span className="sr-only">CoreNovaIT portal</span>
    </span>
  );
}
