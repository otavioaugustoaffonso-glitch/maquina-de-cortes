import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="bg-glow grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-sm text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Página não encontrada</h1>
        <ButtonLink href="/dashboard" className="mt-6">
          Ir para o dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
