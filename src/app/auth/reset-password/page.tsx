import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/ui";
import { getUser } from "@/lib/supabase/server";
import { updatePassword } from "../../(auth)/actions";

export const metadata = { title: "Nova senha" };

export default async function ResetPasswordPage() {
  const { user } = await getUser();
  if (!user) redirect("/login?erro=link");
  return (
    <div className="bg-glow flex min-h-dvh flex-col items-center justify-center gap-8 px-4">
      <Logo />
      <div className="w-full max-w-sm">
        <AuthForm
          title="Defina uma nova senha"
          subtitle={`Conta: ${user.email}`}
          action={updatePassword}
          submitLabel="Salvar nova senha"
          fields={[
            { name: "password", label: "Nova senha", type: "password", autoComplete: "new-password", hint: "mín. 8 caracteres" },
            { name: "confirm", label: "Confirmar senha", type: "password", autoComplete: "new-password" },
          ]}
        />
      </div>
    </div>
  );
}
