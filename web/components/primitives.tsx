"use client";

import type { RiskLevel } from "@/lib/riskScore";

export function RiskBadge({
  level,
  score,
}: {
  level: RiskLevel;
  score: number;
}) {
  const styles: Record<RiskLevel, string> = {
    high: "border-risk-high/35 bg-risk-high-deep text-risk-high",
    medium: "border-risk-med/30 bg-risk-med-deep text-risk-med",
    low: "border-risk-low/25 bg-risk-low-deep text-risk-low",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${styles[level]}`}
      title={`Risk score ${score} of 100`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {level}
      <span className="tabular-nums opacity-60">{score}</span>
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-panel ${className}`}
    >
      {title && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            {title}
          </h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Proportional exposure bar. Three bare counts make you do the arithmetic yourself; a filled
 * bar reads at a glance, which is the actual question being asked — "how bad is my wallet?"
 */
export function ExposureBar({
  counts,
  className = "",
}: {
  counts: { high: number; medium: number; low: number };
  className?: string;
}) {
  const total = counts.high + counts.medium + counts.low;
  if (total === 0) return null;

  const segments = [
    { key: "high", value: counts.high, cls: "bg-risk-high" },
    { key: "medium", value: counts.medium, cls: "bg-risk-med" },
    { key: "low", value: counts.low, cls: "bg-risk-low" },
  ].filter((s) => s.value > 0);

  return (
    <div
      className={`flex h-1.5 w-full overflow-hidden rounded-full bg-raised ${className}`}
      role="img"
      aria-label={`${counts.high} high risk, ${counts.medium} medium, ${counts.low} low`}
    >
      {segments.map((s) => (
        <div
          key={s.key}
          className={s.cls}
          style={{ width: `${(s.value / total) * 100}%` }}
          title={`${s.value} ${s.key}`}
        />
      ))}
    </div>
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
    <div className="flex flex-col gap-1" title={hint}>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </span>
      <span
        className={`font-mono text-[1.75rem] font-medium leading-none tabular-nums ${tones[tone]}`}
      >
        {value}
      </span>
    </div>
  );
}

export function Button({
  children,
  variant = "default",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  const variants = {
    default:
      "border-line-bright bg-raised text-ink hover:border-monad/50 hover:bg-monad/10",
    primary:
      "border-monad/50 bg-monad/12 text-monad-bright hover:border-monad hover:bg-monad/20",
    danger:
      "border-risk-high/40 bg-risk-high-deep text-risk-high hover:border-risk-high/70",
    ghost:
      "border-transparent bg-transparent text-ink-faint hover:text-ink hover:bg-raised",
  };
  const sizes = {
    sm: "px-2 py-1 text-[10px]",
    md: "px-3 py-1.5 text-xs",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-mono uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-inherit disabled:hover:bg-inherit ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`size-3.5 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
