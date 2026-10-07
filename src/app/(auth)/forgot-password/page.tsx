import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { requestPasswordReset } from "../actions";

export const metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <AuthForm
      title="Recuperar senha"
      subtitle="Enviaremos um link para você criar uma nova senha."
      action={requestPasswordReset}
      submitLabel="Enviar link"
      fields={[{ name: "email", label: "E-mail", type: "email", placeholder: "voce@email.com", autoComplete: "email" }]}
      footer={
        <Link href="/login" className="text-violet-300 hover:underline">
          Voltar para o login
        </Link>
      }
    />
  );
}
