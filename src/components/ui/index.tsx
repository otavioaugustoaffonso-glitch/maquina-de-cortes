import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export { clsx as cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_8px_24px_-8px_rgb(139_92_246/0.6)] hover:bg-violet-500",
  secondary: "bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-surface-3",
  ghost: "text-muted hover:text-fg hover:bg-white/5",
  danger: "bg-danger/10 text-red-300 border border-danger/30 hover:bg-danger/20",
};
const sizes = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-base gap-2" };

type BtnProps = { variant?: Variant; size?: keyof typeof sizes; loading?: boolean };

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps & ComponentProps<"button">) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", className, ...rest }: BtnProps & ComponentProps<typeof Link>) {
  return (
    <Link
      className={clsx("inline-flex items-center justify-center rounded-xl font-medium transition", variants[variant], sizes[size], className)}
      {...rest}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={clsx("rounded-2xl border border-line bg-surface", className)} {...rest} />;
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return (
    <input
      className={clsx(
        "h-10 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-subtle outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={clsx(
        "w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-subtle outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...rest}
    />
  );
}

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
      <span>{children}</span>
      {hint && <span className="text-subtle">{hint}</span>}
    </label>
  );
}

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-white/5 text-muted border-line",
  brand: "bg-brand/15 text-violet-300 border-brand/30",
  success: "bg-success/10 text-green-300 border-success/30",
  warning: "bg-warning/10 text-amber-300 border-warning/30",
  danger: "bg-danger/10 text-red-300 border-danger/30",
  info: "bg-brand-2/10 text-cyan-300 border-brand-2/30",
};

export function Badge({ tone = "neutral", className, ...rest }: { tone?: Tone } & ComponentProps<"span">) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone], className)}
      {...rest}
    />
  );
}

export function ScorePill({ score }: { score: number }) {
  const tone = score >= 85 ? "text-green-300 bg-success/10 border-success/30" : score >= 70 ? "text-violet-200 bg-brand/15 border-brand/30" : score >= 55 ? "text-amber-200 bg-warning/10 border-warning/30" : "text-muted bg-white/5 border-line";
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums", tone)}>
      {score}
      <span className="font-normal opacity-60">/100</span>
    </span>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-white/5", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2 transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-brand/10 text-violet-300">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-brand/30">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
        </svg>
      </span>
      Máquina de Cortes
    </span>
  );
}
