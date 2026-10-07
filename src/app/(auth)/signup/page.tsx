import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { signUp } from "../actions";

export const metadata = { title: "Criar conta" };

export default function SignupPage() {
  return (
    <AuthForm
      title="Crie sua conta"
      subtitle="Comece a transformar vídeos longos em cortes virais."
      action={signUp}
      submitLabel="Criar conta"
      fields={[
        { name: "fullName", label: "Nome", placeholder: "Seu nome", autoComplete: "name" },
        { name: "email", label: "E-mail", type: "email", placeholder: "voce@email.com", autoComplete: "email" },
        { name: "password", label: "Senha", type: "password", autoComplete: "new-password", hint: "mín. 8 caracteres" },
      ]}
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" className="text-violet-300 hover:underline">
            Entrar
          </Link>
        </>
      }
    />
  );
}
