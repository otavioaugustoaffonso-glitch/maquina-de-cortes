"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string } | undefined;

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Evita open-redirect: só aceita caminhos internos. */
function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

const credentials = z.object({
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(72),
});

function translate(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).";
  if (/already registered|already exists/i.test(message)) return "Este e-mail já está cadastrado.";
  if (/rate limit/i.test(message)) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  return message;
}

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: translate(error.message) };
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials
    .extend({ fullName: z.string().trim().min(2, "Informe seu nome").max(120) })
    .safeParse({ email: form.get("email"), password: form.get("password"), fullName: form.get("fullName") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=/dashboard`,
    },
  });
  if (error) return { error: translate(error.message) };
  if (data.session) redirect("/dashboard"); // confirmação de e-mail desativada
  return { message: "Conta criada! Enviamos um link de confirmação para o seu e-mail." };
}

export async function requestPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const email = z.string().trim().email().safeParse(form.get("email"));
  if (!email.success) return { error: "E-mail inválido" };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/auth/reset-password`,
  });
  if (error) return { error: translate(error.message) };
  // Resposta idêntica exista ou não a conta (evita enumeração de e-mails)
  return { message: "Se existir uma conta com este e-mail, você receberá um link para redefinir a senha." };
}

export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  const password = z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(72).safeParse(form.get("password"));
  if (!password.success) return { error: password.error.issues[0].message };
  if (form.get("password") !== form.get("confirm")) return { error: "As senhas não conferem." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { error: translate(error.message) };
  redirect("/dashboard?senha=atualizada");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
