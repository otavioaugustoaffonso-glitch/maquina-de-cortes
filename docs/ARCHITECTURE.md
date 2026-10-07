# Arquitetura — Máquina de Cortes

## Visão geral

```
┌──────────────────────────┐         upload direto (TUS, resumable, chunks de 6 MB)
│  Navegador (Next.js/React)│ ───────────────────────────────────────────────┐
│  dashboard · upload ·     │                                                │
│  projeto · editor         │ ── fetch /api/* (JSON, cookies de sessão) ──┐  │
└──────────────────────────┘                                              │  │
                                                                          ▼  ▼
┌──────────────────────────────────────┐        ┌───────────────────────────────────────┐
│  Next.js (Vercel ou Node)             │        │  Supabase                              │
│  • Server Components (leitura c/ RLS) │◀──────▶│  • Auth (e-mail/senha, recuperação)    │
│  • Route Handlers /api/* (validação,  │        │  • Postgres + Row Level Security       │
│    autorização, enfileiramento)       │        │  • Storage (buckets privados)          │
│  • Proxy (renova sessão, protege rotas)│       │  • Fila de jobs = tabela public.jobs   │
└──────────────────────────────────────┘        └───────────────────────────────────────┘
                                                              ▲   claim_job() (SKIP LOCKED)
                                                              │
                                              ┌───────────────┴──────────────────────────┐
                                              │  Worker (Node + FFmpeg + OpenCV, Docker)  │
                                              │  process_video · render_clip · export_zip │
                                              │      │                    │               │
                                              │      ▼                    ▼               │
                                              │  faster-whisper        Ollama / regras    │
                                              │  (local, open source)  (local, open source)│
                                              └───────────────────────────────────────────┘
```

| Camada | Tecnologia | Onde roda | Responsabilidade |
|---|---|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 | Vercel / Node | UI, upload resumable, preview ao vivo de legendas |
| Backend (BFF) | Route Handlers + Server Actions do Next.js | Vercel / Node | Autenticação, validação (zod), autorização, enfileirar jobs, URLs assinadas |
| Banco | Supabase Postgres | Supabase | Dados + RLS + fila de jobs + estatísticas |
| Armazenamento | Supabase Storage (compatível S3) | Supabase | Originais, proxies, cortes, thumbnails, zips |
| Autenticação | Supabase Auth via `@supabase/ssr` | Supabase | Cadastro, login, logout, recuperação de senha, sessão em cookies |
| Filas/background | Tabela `jobs` + `claim_job()` com `FOR UPDATE SKIP LOCKED` | Postgres | Jobs assíncronos, retry exponencial, recuperação de workers mortos |
| Processamento de vídeo | FFmpeg (libx264, AAC, libass) + OpenCV (Python) | Worker (Docker) | Áudio, proxy, cortes, remoção de pausas, 9:16, legendas, thumbnails |
| IA | Interfaces `TranscriptionProvider` e `ClipAnalyzer` | Worker | Transcrição com tempo por palavra e escolha dos cortes. Somente opções gratuitas: faster-whisper e Ollama locais, regras, ou planos gratuitos do Groq/Gemini |

### Por que essas escolhas (MVP)

- **Fila no próprio Postgres** (em vez de Redis/BullMQ/SQS): zero infraestrutura extra, transacional, visível no painel do Supabase, e `SKIP LOCKED` permite vários workers em paralelo. Trocar por SQS/BullMQ no futuro só exige reimplementar `worker/queue.ts`.
- **Worker separado do Next.js**: FFmpeg é CPU-intensivo e um vídeo longo leva minutos — não cabe em funções serverless (limites de tempo/memória). O worker é um container comum (Railway, Render, Fly.io, VPS, ECS…) e escala horizontalmente.
- **Upload direto ao Storage (TUS)**: o arquivo não passa pelo servidor Next.js (que tem limite de corpo de requisição), suporta vários GB, retoma após quedas e mostra progresso real.
- **100% gratuito**: só há ferramentas open source locais (faster-whisper, Ollama, FFmpeg, OpenCV, Supabase local) e, opcionalmente, planos gratuitos sem cartão (Groq, Gemini). Integrações pagas foram removidas do código.
- **faster-whisper para transcrição**: devolve o tempo de cada palavra — base de tudo (cortes precisos, remoção de pausas, legendas sincronizadas) — sem enviar o áudio para fora.
- **Ollama para análise**: modelos abertos rodando localmente, chamados pela mesma interface compatível usada pelos planos gratuitos em nuvem. Sem IA instalada, a análise por regras funciona sem dependências.

## Pipeline de processamento (economia de IA)

```
upload ─▶ process_video
           1. ffprobe: valida conteúdo real (tem vídeo? tem áudio? duração?)
           2. extrai áudio MP3 mono 16 kHz 32 kbps (~14 MB/h)    ┐ em paralelo:
           3. TRANSCRIÇÃO (1 chamada por pedaço de ~10 min)       │ proxy 540p p/ preview
              - pedaços cortados no meio de silêncios             ┘ e detecção de rosto
           4. ANÁLISE: 1 chamada ao LLM com SÓ O TEXTO
              "[12.4-18.9] frase..." (vídeos > ~4 h: janelas)
           5. pós-processamento local (sem IA): ajuste às palavras, corte de
              introduções vazias, validação de duração, score, deduplicação
           6. grava cortes e enfileira 1 job por corte
                       │
                       ▼
        render_clip (N jobs em paralelo, entre vários workers) — SEM IA
           remoção de pausas · enquadramento (rosto) · legendas ASS ·
           título na tela · H.264/AAC 1080×1920 · thumbnail
```

Regras de custo implementadas:

- O vídeo **nunca** é enviado a um LLM; só o texto da transcrição.
- Transcrição e análise acontecem **uma vez por vídeo**. Em retry, `process_video` reaproveita a transcrição e os cortes já salvos (`transcripts`/`clips`).
- Editar, re-renderizar, trocar estilo de legenda, formato ou intervalo **não chama IA** (só FFmpeg).
- Resposta da IA em JSON validado; itens malformados são descartados em vez de repetir a chamada.
- Todo consumo é registrado em `usage_events` (segundos transcritos, tokens de entrada/saída, segundos renderizados) — base para créditos/planos.
- Limite de vídeos simultâneos por usuário (`MAX_CONCURRENT_VIDEOS`) e de duração (`MAX_VIDEO_SECONDS`).

## Sistema de pontuação (0–100)

`src/lib/clips/scoring.ts` — combina notas semânticas da IA (0–10) com métricas locais calculadas dos timestamps:

| Fator | Peso | Origem |
|---|---|---|
| Força do gancho (3 primeiros segundos) | 24% | IA |
| Funciona fora do contexto original | 15% | IA |
| Valor entregue | 15% | IA |
| Clareza | 10% | IA |
| Emoção | 10% | IA |
| Curiosidade | 10% | IA |
| Fluidez da fala (ritmo palavras/s, pausas, vícios de linguagem, começa/termina em frase completa) | 16% | Local |

Potencial de retenção: ≥85 "Muito alto", ≥70 "Alto", ≥55 "Médio", senão "Baixo". Os cortes são ordenados pelo score (rank 1 = melhor). Sobreposições > 30% são removidas mantendo o de maior score.

## Edição automática

| Recurso | Implementação |
|---|---|
| Corte de silêncio / pausas | `computeKeepSegments` (timestamps das palavras) → `trim`/`atrim` + `concat` com micro-fades |
| Remover introduções vazias | `trimLeadingFillers` ("bom", "pessoal", "então", "né"…) + instrução ao LLM |
| Não cortar palavras | `snapToWords` alinha início/fim às palavras |
| 9:16 / 4:5 / 1:1 / 16:9 | `buildFilterGraph`: crop + scale (lanczos) ou "inteiro + fundo desfocado" |
| Rosto centralizado | `face_detect.py` (OpenCV Haar) → trilha suavizada com zona morta → expressão `crop x(t)` com pans de 0,35 s |
| Legendas sincronizadas | ASS gerado por `buildAss`, queimado com `libass`; palavra falada destacada (karaokê), palavras-chave coloridas, animações pop/fade |
| Estilos | minimalista, destaque de palavras, viral, podcast, clean — fonte, tamanho, posição, cores, fundo, opacidade, animação, palavras por linha, caixa alta |
| Título na tela | evento ASS no topo nos primeiros 4,5 s |
| Thumbnail/capa | quadro do início do corte já com título e legenda |
| Áudio | `loudnorm` (−14 LUFS, padrão de redes sociais), AAC 160 kbps 48 kHz |
| Saída | MP4, H.264 High@4.2, yuv420p, `+faststart`, até 60 fps |

O preview do editor (`components/editor`) usa **as mesmas funções** de agrupamento/remapeamento de tempo do renderizador, então o que se vê no navegador corresponde ao vídeo final.

## Modelo de dados

```
auth.users 1─1 profiles            (plano, créditos, preferências)
auth.users 1─N projects 1─N videos 1─1 transcripts (texto, segmentos, palavras c/ timestamps)
                         └─N clips  (tempos, textos da IA, score, estilo, formato, saída)
                         └─N exports (zip de cortes)
jobs        (fila: tipo, payload, status, tentativas, heartbeat)
usage_events (consumo por usuário/vídeo)
```

Status do vídeo (`video_status`): `uploading → queued → extracting_audio → transcribing → analyzing → finding_moments → generating_clips → adding_captions → finalizing → completed` (ou `failed`).
Status do corte (`clip_status`): `suggested | queued | rendering | ready (pendente) | approved | failed`.

## Segurança

- **RLS em todas as tabelas**: cada usuário só lê/edita o que é seu. `videos`, `transcripts`, `exports`, `jobs` não aceitam escrita do client; triggers impedem alterar campos de sistema (`score`, `output_path`, plano, créditos…).
- **Storage privado**: caminhos `{user_id}/{project_id}/…`; políticas restringem upload/leitura à própria pasta; acesso via URLs assinadas de curta duração.
- **Chaves**: `SUPABASE_SERVICE_ROLE_KEY` e as chaves opcionais de planos gratuitos (`GROQ_API_KEY`, `GEMINI_API_KEY`) existem só no servidor/worker (nunca `NEXT_PUBLIC_*`). `server-only` impede import acidental no client.
- **APIs**: sessão validada no Supabase Auth (`getUser`), checagem de mesma origem em mutações (CSRF), validação de entrada com zod, erros internos não vazam detalhes, proteção contra open-redirect.
- **Uploads**: whitelist de extensões/MIME, limite de tamanho (API + bucket), validação do conteúdo real com `ffprobe` no worker, limite de duração.
- **Processos**: FFmpeg/Python executados sem shell (`spawn` com array de argumentos).

## Preparado para o futuro

| Evolução | Ponto de extensão já existente |
|---|---|
| Planos pagos / créditos | `profiles.plan`, `profiles.credits_seconds`, `ENFORCE_CREDITS`, `usage_events` (débito idempotente) |
| Equipes / múltiplos usuários | adicionar `organizations` + `organization_members` e trocar `user_id = auth.uid()` das políticas por pertença à organização |
| Histórico | `usage_events`, `jobs` (com tentativas e erros), `exports` |
| API pública | Route Handlers já isolam a lógica; adicionar autenticação por API key + rate limit |
| Publicação automática (Instagram, TikTok, YouTube) | novo `job_type` (`publish_clip`) + tabela `social_accounts`; os cortes já têm título, legenda e hashtags |
| Analytics dos vídeos | tabela `clip_metrics` alimentada por jobs periódicos usando as APIs das plataformas |
| Títulos/hashtags/thumbnails com IA | já gerados na análise; regenerar = novo job barato só com o texto do corte |
| Trocar provedor de IA | implementar `TranscriptionProvider` / `ClipAnalyzer` e registrar em `worker/ai/*/index.ts` (integrações pagas podem ser recuperadas do histórico do git, se um dia forem desejadas) |
| Escalar processamento | mais réplicas do worker (`claim_job` com `SKIP LOCKED`), `WORKER_CONCURRENCY`, GPU/NVENC no futuro |

## Estrutura de pastas

```
src/
  app/
    (auth)/            login, signup, forgot-password + server actions de auth
    (app)/             área logada: dashboard, projects, projects/[id], editor, settings
    api/               uploads, videos, projects, clips, exports
    auth/              callback (PKCE), confirm (token_hash), reset-password
  components/          UI, upload, projeto, editor (preview, timeline, estilos)
  lib/
    captions/          estilos, agrupamento e gerador ASS (compartilhado web + worker)
    clips/             timing (silêncios, remapeamento), score, pós-processamento
    ai/                formatação/janelas/junção de transcrições
    supabase/          clients browser/server/admin + proxy de sessão
    server/            helpers de API e mídia (server-only)
  proxy.ts             renova sessão e protege rotas
worker/
  index.ts             loop da fila, concorrência, heartbeat, manutenção
  queue.ts             claim/complete/fail/retry
  jobs/                process-video, render-clip, export-zip
  media/               ffmpeg, áudio, proxy, render, enquadramento (OpenCV)
  ai/transcription/    faster-whisper local, Groq (plano gratuito) + mock de testes
  ai/analysis/         regras, Ollama/servidor local, Gemini/Groq (planos gratuitos)
  Dockerfile
supabase/migrations/   schema, RLS, fila, storage
supabase/tests/        teste de fumaça de RLS
tests/                 testes unitários (vitest)
scripts/e2e-local.ts   teste ponta a ponta do pipeline de mídia
```
