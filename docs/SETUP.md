# Configuração — serviços externos, chaves e custos

> Preços consultados em outubro/2026 e sujeitos a mudança — confira sempre a página oficial de cada serviço antes de colocar em produção.

Resumo do que você precisa:

| Serviço | Para quê | Obrigatório? | Variáveis |
|---|---|---|---|
| Supabase | Banco, Auth, Storage, fila | Sim | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| OpenAI **ou** Groq | Transcrição (Whisper, timestamps por palavra) | Sim (um dos dois) | `TRANSCRIPTION_PROVIDER`, `OPENAI_API_KEY` / `GROQ_API_KEY` |
| Anthropic | Análise da transcrição e escolha dos cortes | Recomendado (existe alternativa gratuita de baixa qualidade) | `ANALYSIS_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Hospedagem web | Next.js | Sim | — |
| Hospedagem do worker | FFmpeg/OpenCV em background | Sim | — |

---

## 1. Supabase (banco, autenticação, armazenamento)

**Onde criar:** https://supabase.com/dashboard → *New project* (escolha a região mais próxima dos usuários, ex.: São Paulo `sa-east-1`).

**Onde obter as chaves:** *Project Settings → API* (ou *API Keys*):

| Variável | Valor | Onde usar |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) | web + worker |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave **anon** / **publishable** (pública, protegida por RLS) | web |
| `SUPABASE_SERVICE_ROLE_KEY` | chave **service_role** / **secret** — **NUNCA exponha no navegador** | servidor Next.js + worker |

**Criar o banco:**

- Opção A (mais simples): *SQL Editor* → cole e execute, nesta ordem,
  `supabase/migrations/20261007000001_init.sql` e `supabase/migrations/20261007000002_storage.sql`.
- Opção B (CLI): `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`.
- Opcional: rode `supabase/tests/rls_smoke_test.sql` num banco de teste para validar as políticas (ele faz `rollback` ao final).

**Autenticação:** *Authentication → URL Configuration*

- *Site URL*: `http://localhost:3000` (dev) e depois a URL de produção.
- *Redirect URLs*: `http://localhost:3000/auth/callback`, `https://SEU-DOMINIO/auth/callback` e `https://SEU-DOMINIO/auth/confirm`.
- *Authentication → Providers → Email*: deixe "Confirm email" ligado em produção.
- Em produção configure um SMTP próprio (*Authentication → SMTP Settings*, ex.: Resend, Postmark, SES): o SMTP padrão do Supabase tem limite baixo de e-mails por hora e serve só para testes.
- (Opcional) Para que o link de recuperação funcione em outro dispositivo, edite o template *Reset Password* para:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password`

**Storage:** os buckets `videos`, `clips` e `exports` (privados) são criados pela migration.
⚠️ **Limite de tamanho por arquivo:** no plano Free o limite global de upload é baixo (50 MB por arquivo), o que impede vídeos longos. No plano Pro ajuste em *Storage → Settings → Upload file size limit* (o bucket `videos` da migration aceita até 10 GB; mantenha `MAX_UPLOAD_BYTES` coerente).

**Custo aproximado:**

- Free: US$ 0 — 500 MB de banco, 1 GB de storage, 2 projetos (pausa por inatividade). Bom para desenvolvimento com vídeos pequenos.
- Pro: **US$ 25/mês** por organização — inclui 100 GB de storage (excedente ≈ US$ 0,021/GB/mês), 8 GB de banco e egress incluso com cobrança por excedente.
- Estimativa de armazenamento: 1 h de vídeo 1080p ≈ 1–3 GB (original) + ~150 MB (proxy) + ~10–25 MB por corte. Use `EXPORT_TTL_DAYS` e exclua projetos antigos para controlar custos.

**Alternativa gratuita:** Supabase self-hosted (Docker) ou o plano Free para testes. Storage compatível com S3 (Cloudflare R2, AWS S3) é possível trocando `worker/storage.ts` e o upload TUS do navegador por URLs pré-assinadas multipart.

---

## 2. Transcrição — OpenAI Whisper (padrão) ou Groq

O sistema precisa de **timestamps por palavra**. Por isso usa o modelo `whisper-1` (OpenAI) ou `whisper-large-v3(-turbo)` (Groq), ambos com `response_format=verbose_json` + `timestamp_granularities[]=word`. Os modelos `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` são mais baratos/precisos, mas **não retornam timestamps por palavra** — por isso não são usados.

O áudio é extraído em MP3 mono 16 kHz 32 kbps (~14 MB/h) e, se passar do limite de 25 MB por requisição, é dividido em pedaços de ~10 min cortados no meio de silêncios.

### Opção A — OpenAI (padrão)

- **Conta:** https://platform.openai.com/signup → adicione créditos em *Settings → Billing*.
- **API key:** https://platform.openai.com/api-keys → *Create new secret key*.
- **Variáveis:**
  ```
  TRANSCRIPTION_PROVIDER=openai
  OPENAI_API_KEY=sk-...
  ```
- **Custo:** `whisper-1` ≈ **US$ 0,006/min** → **~US$ 0,36 por hora de vídeo**.

### Opção B — Groq (mais barato e mais rápido)

- **Conta:** https://console.groq.com → **API key:** https://console.groq.com/keys
- **Variáveis:**
  ```
  TRANSCRIPTION_PROVIDER=groq
  GROQ_API_KEY=gsk_...
  GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo   # ou whisper-large-v3 (mais preciso)
  ```
- **Custo:** `whisper-large-v3-turbo` ≈ **US$ 0,04 por hora de áudio**; `whisper-large-v3` ≈ US$ 0,111/h.
- **Alternativa gratuita:** o Groq tem camada gratuita com limites de requisições/minuto e de áudio por hora/dia — suficiente para testes.

### Alternativa 100% gratuita (self-hosted)

Rodar o Whisper localmente (ex.: `faster-whisper` ou `whisper.cpp`, ambos com timestamps por palavra) no worker. Basta implementar `TranscriptionProvider` em `worker/ai/transcription/` — o restante do pipeline não muda. Exige CPU/GPU dedicada.

---

## 3. Análise dos cortes — Anthropic Claude

- **Conta:** https://console.anthropic.com → *Billing* para adicionar créditos.
- **API key:** https://console.anthropic.com/settings/keys → *Create Key*.
- **Variáveis:**
  ```
  ANALYSIS_PROVIDER=anthropic
  ANTHROPIC_API_KEY=sk-ant-...
  ANTHROPIC_MODEL=claude-opus-5-5     # padrão
  ANTHROPIC_EFFORT=high               # low | medium | high | xhigh | max
  ```
- **Como é usado:** uma chamada por vídeo (vídeos acima de ~4 h são divididos em janelas), enviando apenas o texto `[início-fim] frase`. Resposta em JSON estruturado validado por schema, com *adaptive thinking* e *prompt caching* do prompt de sistema. O parâmetro `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) faz a própria API tentar um modelo alternativo caso a requisição seja recusada pelos classificadores de segurança.
- **Preços por milhão de tokens (entrada / saída):**
  | Modelo | Entrada | Saída |
  |---|---|---|
  | `claude-opus-5-5` (padrão, melhor qualidade) | US$ 4 | US$ 20 |
  | `claude-sonnet-5-5` | US$ 2 | US$ 10 |
  | `claude-haiku-4-5` | US$ 1 | US$ 5 |
- **Estimativa por hora de vídeo** (~10 mil palavras ≈ 20–30 mil tokens de entrada; 7–20 mil de saída incluindo raciocínio): **~US$ 0,25–0,55 com Opus 5.5**, cerca de metade com Sonnet 5.5. O consumo real fica registrado em `usage_events` (`llm_input_tokens`, `llm_output_tokens`).
- **Alternativa gratuita:** `ANALYSIS_PROVIDER=heuristic` — seleção por regras (palavras de impacto, perguntas, densidade). Custo zero, mas qualidade bem inferior; útil para desenvolvimento.
- **Trocar de provedor:** implemente `ClipAnalyzer` em `worker/ai/analysis/` e registre em `index.ts`.

---

## 4. Custo total estimado por vídeo

| Item | 1 h de vídeo |
|---|---|
| Transcrição (OpenAI whisper-1 / Groq turbo) | US$ 0,36 / US$ 0,04 |
| Análise (Claude Opus 5.5) | ~US$ 0,25–0,55 |
| Renderização (FFmpeg no seu worker) | só CPU do servidor |
| **Total de APIs** | **~US$ 0,30–0,90** |

Editar, re-renderizar, mudar legenda/formato e exportar **não geram custo de IA**.

---

## 5. Hospedagem

### Web (Next.js)

- **Vercel** (recomendado): importe o repositório em https://vercel.com/new, configure as variáveis de ambiente (as `NEXT_PUBLIC_*`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `MAX_UPLOAD_BYTES`, `MAX_CONCURRENT_VIDEOS`). Hobby é gratuito (uso não comercial); Pro ≈ US$ 20/usuário/mês. O upload de vídeo vai direto ao Supabase, então não há problema com limite de corpo das funções.
- Alternativas: Netlify, Railway, Render ou qualquer servidor Node (`npm run build && npm start`).

### Worker (FFmpeg)

Precisa de um container de longa duração (não serverless):

```bash
docker build -f worker/Dockerfile -t maquina-de-cortes-worker .
docker run --env-file .env maquina-de-cortes-worker
```

- Opções: Railway, Render (Background Worker), Fly.io, Google Cloud Run Jobs, AWS ECS/Fargate ou uma VPS (Hetzner, DigitalOcean…).
- Recomendação inicial: **4 vCPU / 8 GB RAM** e disco temporário de ~20 GB por vídeo longo simultâneo. Custo típico em VPS: ~US$ 10–40/mês.
- Escala: aumente `WORKER_CONCURRENCY` ou rode mais réplicas — a fila (`claim_job` com `SKIP LOCKED`) distribui os jobs sem duplicar.
- Ajuste qualidade/velocidade com `X264_PRESET` (`veryfast` é ~3× mais rápido que `medium`) e `X264_CRF`.

---

## 6. Rodando localmente

```bash
npm install
cp .env.example .env.local        # preencha (web)
cp .env.example .env              # preencha (worker) — pode ser o mesmo conteúdo
npm run fonts                     # baixa as fontes das legendas para worker/fonts
pip install -r worker/requirements.txt   # OpenCV 4.x (detecção de rosto)

npm run dev                       # http://localhost:3000
npm run worker                    # em outro terminal (requer ffmpeg e python3 no PATH)
```

Testes:

```bash
npm test             # unitários (legendas, timing, score, render, enquadramento, áudio)
npm run test:e2e     # pipeline de mídia completo, local, sem custo de API
npm run typecheck && npm run lint
```
