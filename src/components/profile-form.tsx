"use client";

import { useActionState } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { Button, Card, Input, Label } from "@/components/ui";
import { CAPTION_PRESETS } from "@/lib/captions/styles";

export function ProfileForm({ email, fullName, defaultPreset }: { email: string; fullName: string; defaultPreset: string }) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  return (
    <Card className="p-6">
      <form action={action} className="space-y-4">
        <div>
          <Label>E-mail</Label>
          <Input value={email} disabled />
        </div>
        <div>
          <Label htmlFor="fullName">Nome</Label>
          <Input id="fullName" name="fullName" defaultValue={fullName} required />
        </div>
        <div>
          <Label htmlFor="defaultPreset">Estilo de legenda preferido</Label>
          <select
            id="defaultPreset"
            name="defaultPreset"
            defaultValue={defaultPreset}
            className="h-10 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none"
          >
            {Object.entries(CAPTION_PRESETS).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {state?.error && <p className="text-sm text-red-300">{state.error}</p>}
        {state?.message && <p className="text-sm text-green-300">{state.message}</p>}
        <Button type="submit" loading={pending}>
          Salvar
        </Button>
      </form>
    </Card>
  );
}
