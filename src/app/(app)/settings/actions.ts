"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPTION_PRESETS } from "@/lib/captions/styles";
import { createClient } from "@/lib/supabase/server";

export type ProfileState = { error?: string; message?: string } | undefined;

export async function updateProfile(_: ProfileState, form: FormData): Promise<ProfileState> {
  const parsed = z
    .object({
      fullName: z.string().trim().min(2, "Informe seu nome").max(120),
      defaultPreset: z.enum(Object.keys(CAPTION_PRESETS) as [keyof typeof CAPTION_PRESETS]),
    })
    .safeParse({ fullName: form.get("fullName"), defaultPreset: form.get("defaultPreset") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Sessão expirada" };
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, preferences: { defaultCaptionPreset: parsed.data.defaultPreset } })
    .eq("id", data.user.id);
  if (error) return { error: "Não foi possível salvar." };
  revalidatePath("/", "layout");
  return { message: "Perfil atualizado." };
}
