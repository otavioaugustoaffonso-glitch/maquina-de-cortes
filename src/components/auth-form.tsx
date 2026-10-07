"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { Button, Card, Input, Label } from "@/components/ui";

type Field = { name: string; label: string; type?: string; placeholder?: string; autoComplete?: string; hint?: React.ReactNode };

export function AuthForm({
  title,
  subtitle,
  action,
  fields,
  submitLabel,
  footer,
  hidden,
}: {
  title: string;
  subtitle: string;
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  fields: Field[];
  submitLabel: string;
  footer?: React.ReactNode;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <form action={formAction} className="mt-6 space-y-4">
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {fields.map((f) => (
          <div key={f.name}>
            <Label htmlFor={f.name} hint={f.hint}>
              {f.label}
            </Label>
            <Input id={f.name} name={f.name} type={f.type ?? "text"} placeholder={f.placeholder} autoComplete={f.autoComplete} required />
          </div>
        ))}
        {state?.error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-red-300">{state.error}</p>}
        {state?.message && <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-green-300">{state.message}</p>}
        <Button type="submit" className="w-full" loading={pending}>
          {submitLabel}
        </Button>
      </form>
      {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
    </Card>
  );
}

export { Link };
