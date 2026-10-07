import Link from "next/link";
import { ProfileForm } from "@/components/profile-form";
import { Card } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Perfil" };

export default async function SettingsPage() {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
  const { data: usage } = await supabase.from("usage_events").select("kind, amount").limit(5000);
  const sum = (k: string) => (usage ?? []).filter((u) => u.kind === k).reduce((a, u) => a + Number(u.amount), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
        <p className="mt-1 text-sm text-muted">Gerencie sua conta e preferências.</p>
      </div>
      <ProfileForm
        email={user!.email ?? ""}
        fullName={profile?.full_name ?? ""}
        defaultPreset={(profile?.preferences as { defaultCaptionPreset?: string } | null)?.defaultCaptionPreset ?? "highlight"}
      />
      <Card className="p-6">
        <h2 className="font-medium">Plano e uso</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Plano" value={(profile?.plan ?? "free").toUpperCase()} />
          <Stat label="Créditos restantes" value={formatDuration(profile?.credits_seconds ?? 0)} />
          <Stat label="Áudio transcrito" value={formatDuration(sum("transcription_seconds"))} />
          <Stat label="Vídeo renderizado" value={formatDuration(sum("render_seconds"))} />
        </div>
        <p className="mt-4 text-xs text-subtle">Planos pagos e compra de créditos estarão disponíveis em breve.</p>
      </Card>
      <Card className="p-6">
        <h2 className="font-medium">Segurança</h2>
        <p className="mt-1 text-sm text-muted">Para trocar a senha, enviaremos um link para o seu e-mail.</p>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm text-violet-300 hover:underline">
          Redefinir senha
        </Link>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
