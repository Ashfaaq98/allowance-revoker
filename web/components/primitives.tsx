"use client";

import type {RiskLevel} from "@/lib/riskScore";

export function RiskBadge({level, score}: {level: RiskLevel; score: number}) {
  const styles: Record<RiskLevel, string> = {
    high: "border-risk-high/40 bg-risk-high-deep text-risk-high",
    medium: "border-risk-med/30 bg-risk-med-deep text-risk-med",
    low: "border-risk-low/30 bg-risk-low-deep text-risk-low",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${styles[level]}`}
      title={`Risk score ${score} of 100`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {level}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-lg border border-line bg-surface/80 backdrop-blur-sm ${className}`}
    >
      {title && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "danger" | "warn" | "good" | "monad";
  hint?: string;
}) {
  const tones = {
    default: "text-ink",
    danger: "text-risk-high",
    warn: "text-risk-med",
    good: "text-ok",
    monad: "text-monad-bright",
  };
  return (
    <div className="flex flex-col gap-0.5" title={hint}>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">{label}</span>
      <span className={`font-mono text-2xl leading-none tabular-nums ${tones[tone]}`}>{value}</span>
    </div>
  );
}

export function Button({
  children,
  variant = "default",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
}) {
  const variants = {
    default:
      "border-line-bright bg-raised text-ink hover:border-monad/50 hover:bg-monad/10 disabled:hover:border-line-bright disabled:hover:bg-raised",
    primary:
      "border-monad/50 bg-monad/15 text-monad-bright hover:border-monad hover:bg-monad/25 disabled:hover:border-monad/50 disabled:hover:bg-monad/15",
    danger:
      "border-risk-high/40 bg-risk-high/10 text-risk-high hover:border-risk-high/80 hover:bg-risk-high/20 disabled:hover:border-risk-high/40 disabled:hover:bg-risk-high/10",
    ghost: "border-transparent bg-transparent text-ink-dim hover:text-ink hover:bg-raised",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({className = ""}: {className?: string}) {
  return (
    <svg
      className={`size-3.5 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
