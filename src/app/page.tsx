import { ArrowRight, Captions, Crop, Gauge, Scissors, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { ButtonLink, Logo } from "@/components/ui";

const features = [
  { icon: Sparkles, title: "IA encontra os melhores momentos", text: "Ganchos fortes, histórias, dicas e opiniões — cada corte faz sentido sozinho." },
  { icon: Gauge, title: "Score de potencial 0–100", text: "Gancho, clareza, valor, emoção e fluidez da fala. Os melhores cortes primeiro." },
  { icon: Crop, title: "Vertical 9:16 automático", text: "Enquadramento que acompanha o rosto e saída 1080×1920 pronta para publicar." },
  { icon: Captions, title: "Legendas animadas", text: "Palavra a palavra, estilos viral, podcast, clean — fonte, cor e posição editáveis." },
  { icon: Scissors, title: "Sem silêncios", text: "Pausas e introduções vazias removidas para máxima retenção nos primeiros segundos." },
  { icon: Zap, title: "Processamento em segundo plano", text: "Envie vídeos longos e acompanhe cada etapa. Pode fechar a aba." },
];

export default function Home() {
  return (
    <div className="bg-glow min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className="px-3 py-2 text-sm text-muted hover:text-fg">
            Entrar
          </Link>
          <ButtonLink href="/signup" size="sm">
            Começar grátis
          </ButtonLink>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6">
        <section className="py-20 text-center sm:py-28">
          <p className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-muted">
            <Sparkles className="size-3.5 text-violet-300" /> TikTok · Reels · Shorts
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
            Um vídeo longo entra. <span className="text-gradient">Dezenas de cortes virais</span> saem.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted sm:text-lg">
            Envie seu podcast, aula ou live. A IA transcreve, encontra os melhores momentos e entrega cortes verticais com legendas, prontos para revisar e publicar.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <ButtonLink href="/signup" size="lg">
              Criar meus cortes <ArrowRight className="size-4" />
            </ButtonLink>
          </div>
        </section>
        <section className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-line bg-surface/70 p-6">
              <div className="mb-4 grid size-10 place-items-center rounded-xl bg-brand/15 text-violet-300">
                <Icon className="size-5" />
              </div>
              <h3 className="font-medium">{title}</h3>
              <p className="mt-1.5 text-sm text-muted">{text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
