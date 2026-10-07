# Configuração — 100% gratuita

Tudo roda no seu computador com software open source. Não é preciso criar conta, gerar chave de API nem cadastrar cartão. Detalhes de limites e custos: [CUSTOS.md](CUSTOS.md).

## O que instalar

| Ferramenta | Para quê | Onde baixar |
|---|---|---|
| Node.js 22 | Site e worker | https://nodejs.org |
| Docker Desktop (ou Docker Engine) | Supabase local | https://www.docker.com/products/docker-desktop |
| ffmpeg | Cortar e montar os vídeos | https://ffmpeg.org/download.html (Windows: `winget install ffmpeg`; macOS: `brew install ffmpeg`; Linux: `apt install ffmpeg`) |
| Python 3.10+ | Detecção de rosto e transcrição local | https://www.python.org/downloads |
| Ollama (opcional, recomendado) | IA local para escolher os cortes | https://ollama.com/download |

O Docker Desktop é gratuito para uso pessoal, educacional e empresas pequenas; confira os termos se sua empresa for grande. Alternativas totalmente livres: Docker Engine (Linux) ou Podman.

## Jeito mais fácil

Rode `instalar.bat` (Windows) ou `./instalar.sh` (Mac/Linux) uma vez e depois `iniciar.bat` / `./iniciar.sh`. O instalador faz todos os passos abaixo sozinho, inclusive preencher o `.env`. Guia para leigos: [COMO-USAR.md](../COMO-USAR.md).

## Passo a passo manual

```bash
# 1. Dependências do projeto
npm install
pip install -r worker/requirements.txt   # OpenCV + faster-whisper
npm run fonts                            # fontes das legendas (Google Fonts, licença OFL)

# 2. Supabase local (banco, login e arquivos)
npx supabase start                       # usa supabase/config.toml
npx supabase db reset                    # cria as tabelas, as regras de acesso e os buckets

# 3. Variáveis de ambiente
cp .env.example .env.local
cp .env.example .env
# cole nos dois arquivos a "API URL", a "anon key" e a "service_role key" impressas pelo `supabase start`

# 4. Rodar
npm run dev        # site em http://localhost:3000
npm run worker     # processamento, em outro terminal
```

Na primeira transcrição, o faster-whisper baixa o modelo escolhido (gratuito; o `small` tem cerca de 500 MB).

Os e-mails de confirmação e de recuperação de senha não saem da sua máquina: o Supabase local mostra todos num painel de e-mails (o endereço aparece na saída do `supabase start`).

## Melhorar a escolha dos cortes com IA local (Ollama)

A análise padrão usa regras simples. Para cortes melhores, ainda grátis e sem enviar nada para fora:

```bash
ollama pull qwen2.5:7b        # ~5 GB; precisa de ~8 GB de RAM livre
```

No `.env`:

```
ANALYSIS_PROVIDER=ollama
LLM_MODEL=qwen2.5:7b
```

Com 16 GB de RAM ou mais, `qwen2.5:14b` tende a escolher cortes melhores. Também funciona com LM Studio ou llama.cpp (`ANALYSIS_PROVIDER=openai-compatible` e `LLM_BASE_URL` apontando para o servidor local).

## Ajustes para computadores mais modestos

| Situação | Ajuste no `.env` |
|---|---|
| Transcrição lenta | `LOCAL_WHISPER_MODEL=base` (mais rápido, um pouco menos preciso) |
| Tem GPU NVIDIA | `LOCAL_WHISPER_DEVICE=cuda` e `LOCAL_WHISPER_MODEL=large-v3-turbo` |
| Pouca RAM para o Ollama | Fique com `ANALYSIS_PROVIDER=heuristic` ou use um modelo de 3B (`qwen2.5:3b`) |
| Renderização lenta | `X264_PRESET=ultrafast` e `MAX_AUTO_RENDER=5` |
| Pouco espaço em disco | `PROXY_ENABLED=false` e exclua projetos antigos pelo app |

## Opcional: planos gratuitos em nuvem

Se o computador for lento, dá para usar APIs que têm plano gratuito. **Crie as chaves sem cadastrar cartão e sem ativar faturamento**; assim, ao atingir o limite, as requisições são só recusadas.

| Uso | Onde criar a chave | Variáveis |
|---|---|---|
| Transcrição (Groq) | https://console.groq.com/keys | `TRANSCRIPTION_PROVIDER=groq`, `GROQ_API_KEY=...` |
| Análise (Groq) | mesma chave | `ANALYSIS_PROVIDER=groq` |
| Análise (Gemini) | https://aistudio.google.com/apikey | `ANALYSIS_PROVIDER=gemini`, `GEMINI_API_KEY=...` |

Nesses casos o áudio (Groq) ou o texto da transcrição (Groq/Gemini) sai do seu computador. O vídeo nunca é enviado.

## Colocar online sem pagar (opcional)

- **Oracle Cloud Always Free:** uma VM ARM com 4 núcleos e 24 GB de RAM roda tudo (Supabase via Docker, site, worker, faster-whisper e Ollama). O cadastro pede cartão só para verificação; não converta a conta para "Pay As You Go".
- **Vercel Hobby:** hospeda só o site, para uso não comercial.
- O Supabase hospedado no plano Free **não serve para vídeos**: limita cada arquivo a 50 MB.

## Testes

```bash
npm test             # testes automáticos
npm run test:e2e     # pipeline de vídeo completo, local
npm run typecheck && npm run lint
```
