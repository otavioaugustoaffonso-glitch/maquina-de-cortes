import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { signIn } from "../actions";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const { next, erro } = await searchParams;
  return (
    <>
      {erro && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-amber-200">
          Link inválido ou expirado. Tente novamente.
        </p>
      )}
      <AuthForm
        title="Bem-vindo de volta"
        subtitle="Entre para continuar criando cortes."
        action={signIn}
        hidden={{ next: next ?? "/dashboard" }}
        submitLabel="Entrar"
        fields={[
          { name: "email", label: "E-mail", type: "email", placeholder: "voce@email.com", autoComplete: "email" },
          {
            name: "password",
            label: "Senha",
            type: "password",
            autoComplete: "current-password",
            hint: (
              <Link href="/forgot-password" className="text-violet-300 hover:underline">
                Esqueceu a senha?
              </Link>
            ),
          },
        ]}
        footer={
          <>
            Não tem conta?{" "}
            <Link href="/signup" className="text-violet-300 hover:underline">
              Criar conta grátis
            </Link>
          </>
        }
      />
    </>
  );
}
