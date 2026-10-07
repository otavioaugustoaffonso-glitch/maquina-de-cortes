import { UploadForm } from "@/components/upload-form";
import { ACCEPTED_EXTENSIONS } from "@/lib/constants";
import { serverLimits } from "@/lib/server/api";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Novo projeto" };

export default async function NewProjectPage() {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", user!.id).maybeSingle();
  const preset = (profile?.preferences as { defaultCaptionPreset?: string } | null)?.defaultCaptionPreset;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Novo projeto</h1>
      <p className="mt-1 text-sm text-muted">
        Envie um vídeo longo ({ACCEPTED_EXTENSIONS.filter((e) => e !== ".m4v").map((e) => e.slice(1).toUpperCase()).join(", ")}). A IA transcreve, encontra os
        melhores momentos e gera os cortes verticais automaticamente.
      </p>
      <div className="mt-8">
        <UploadForm maxBytes={serverLimits.maxUploadBytes} defaultPreset={preset} />
      </div>
    </div>
  );
}
