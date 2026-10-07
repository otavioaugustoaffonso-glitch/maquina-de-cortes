# Custos e alternativas gratuitas

> **Política do projeto:** nada pago é usado por padrão. A configuração padrão roda com **custo zero**
> (transcrição local com faster-whisper + análise heurística). OpenAI e Anthropic ficam **bloqueados no código**
> até você definir `ALLOW_PAID_PROVIDERS=true` — sem isso, o job falha com uma mensagem clara em vez de gerar cobrança.
>
> Limites e preços pesquisados em outubro/2026 a partir de fontes públicas (algumas não oficiais). Eles mudam com frequência:
> **confira a página oficial de cada serviço antes de usar** — principalmente os limites do plano gratuito do Gemini, que o Google mostra por projeto no AI Studio.

## Premissas das estimativas

- Fala em português: ~150 palavras/min → **30 min ≈ 4.500 palavras ≈ 12–15 mil tokens** de entrada para o LLM (texto + marcas de tempo); **1 h ≈ 25–30 mil tokens**. Saída: ~5–15 mil tokens.
- Vídeo 1080p de câmera/celular: **30 min ≈ 0,5–1,5 GB**; **1 h ≈ 1–3 GB**. Proxy de preview ≈ 75 MB/30 min. Cada corte renderizado ≈ 5–25 MB.
- Áudio extraído para transcrição: ~7 MB/30 min (MP3 mono 32 kbps).
- Tempos de CPU são estimativas para uma máquina de 4 núcleos e variam muito com o hardware.

---

## 1. Banco de dados, autenticação e armazenamento — Supabase

| | Supabase **local** (CLI + Docker) | Supabase **hospedado** |
|---|---|---|
| Plano gratuito? | **Sim — software open source, roda na sua máquina** | Sim (Free) |
| Limites do gratuito | Só o seu disco/RAM. Upload até o configurado em `supabase/config.toml` (10 GiB) | 500 MB de banco, **1 GB de arquivos**, 5 GB de egress, **50 MB por arquivo**, 2 projetos, pausa após inatividade |
| Ao ultrapassar | Não há cobrança | O plano Free **não cobra**: uploads acima do limite são recusados. Para ir além é preciso mudar para o Pro (US$ 25/mês, 100 GB inclusos, depois ~US$ 0,021/GB/mês) |
| Vídeo de 30 min | **US$ 0** | **Não cabe**: o original (0,5–1,5 GB) passa do limite de 50 MB por arquivo |
| Vídeo de 1 h | **US$ 0** | **Não cabe** (1–3 GB) |
| Alternativa gratuita/open source | — | Supabase self-hosted (Docker) num servidor gratuito (ver item 5) |

**Conclusão:** para o MVP use o **Supabase local** (`npx supabase start`). O plano Free hospedado serve para Auth/banco, mas não para guardar vídeos longos.

Outra opção futura para armazenar vídeos na nuvem sem custo: **Cloudflare R2** — 10 GB/mês, 1 milhão de operações de escrita e 10 milhões de leitura grátis, sem custo de saída de dados; acima disso ~US$ 0,015/GB/mês. ⚠️ Exige mudar o código de upload/storage (não implementado) e o cadastro pode pedir forma de pagamento.

---

## 2. Transcrição (fala → texto com tempo de cada palavra)

| | **faster-whisper local** (padrão) | **Groq** (API) | OpenAI `whisper-1` (API) |
|---|---|---|---|
| Plano gratuito? | **Sim — open source (MIT), roda no worker** | Sim (plano Free, sem cartão) | **Não** |
| Limites do gratuito | Só CPU/RAM. Modelo `small` ≈ 1 GB de RAM | `whisper-large-v3-turbo`: 20 req/min, 2.000 req/dia, **7.200 s de áudio/hora, 28.800 s/dia (~8 h)**, arquivos de até 25 MB | — |
| Ao ultrapassar | Sem cobrança (só fica mais lento) | No Free as requisições são **recusadas (429)** — o worker espera e tenta de novo. Só há cobrança se você mudar para o plano Developer (cartão): ~US$ 0,04/h de áudio | US$ 0,006/min |
| Vídeo de 30 min | **US$ 0** · ~10–25 min de CPU (modelo `small`) | **US$ 0** (1.800 s de áudio) | US$ 0,18 |
| Vídeo de 1 h | **US$ 0** · ~20–50 min de CPU | **US$ 0** (3.600 s; até ~8 h/dia) | US$ 0,36 |
| Alternativa gratuita/open source | — (já é) | faster-whisper local | faster-whisper local, Groq Free |

Observações:
- O Whisper "tiny/base" é mais rápido e menos preciso; `small` é um bom equilíbrio em CPU; `large-v3-turbo` é o mais preciso (precisa de mais RAM ou GPU).
- Na primeira execução o faster-whisper baixa o modelo do Hugging Face (gratuito).
- `gpt-4o-transcribe` da OpenAI não retorna tempo por palavra, por isso não é usado.

---

## 3. Análise da transcrição (IA que escolhe os cortes)

| | **Heurística** (padrão) | **Gemini** Flash (Google AI Studio) | **Groq** `llama-3.3-70b-versatile` | **Ollama** (local) | Anthropic Claude |
|---|---|---|---|---|---|
| Plano gratuito? | **Sim — regras locais** | Sim (sem ativar faturamento) | Sim (plano Free) | **Sim — open source, local** | **Não** |
| Limites do gratuito | Nenhum | Definidos por projeto no AI Studio; fontes citam ~15 req/min e ~1.500 req/dia no Flash, com cota alta de tokens/min. Só modelos Flash/Flash-Lite garantidos no gratuito | 30 req/min, **12 mil tokens/min**, ~100 mil tokens/dia, 1.000 req/dia | Só hardware: modelo de 7–8B ≈ 6–8 GB de RAM; 14B ≈ 10–12 GB | — |
| Ao ultrapassar | — | Recusa (429) no gratuito; só cobra se você ativar faturamento no projeto | Recusa (429) — o worker espera e tenta de novo | — | — |
| Vídeo de 30 min | **US$ 0** · segundos | **US$ 0** · 1 requisição | **US$ 0** · ~3 requisições em janelas, ~2–4 min por causa do limite/min | **US$ 0** · minutos em CPU (varia muito) | Opus 5.5 ~US$ 0,10–0,30 · Sonnet 5.5 ~metade |
| Vídeo de 1 h | **US$ 0** | **US$ 0** · 1 requisição | **US$ 0** · ~6 janelas, ~5–8 min; cabem ~3 vídeos de 1 h/dia | **US$ 0** | Opus 5.5 ~US$ 0,25–0,55 · Sonnet 5.5 ~metade |
| Qualidade | Baixa (regras) | Boa | Boa | Média–boa (depende do modelo) | Muito boa |
| Alternativa gratuita/open source | — | Ollama | Ollama | — | Gemini/Groq Free, Ollama |

⚠️ **Privacidade no plano gratuito do Gemini:** pelos termos do Google, conteúdo enviado em serviços gratuitos pode ser usado para melhorar os produtos deles. Para conteúdo sensível, prefira Ollama (local) ou heurística.

Configuração (já implementada):

```bash
ANALYSIS_PROVIDER=gemini   GEMINI_API_KEY=...        # https://aistudio.google.com/apikey
ANALYSIS_PROVIDER=groq     GROQ_API_KEY=...          # https://console.groq.com/keys (mesma chave da transcrição)
ANALYSIS_PROVIDER=ollama   LLM_MODEL=qwen2.5:14b     # https://ollama.com — `ollama pull qwen2.5:14b`
```

---

## 4. Hospedagem do site (Next.js)

| | Local (`npm run dev`) | Vercel Hobby | Mesmo servidor do worker (`npm start`) |
|---|---|---|---|
| Plano gratuito? | Sim | Sim — **apenas uso não comercial** | Sim (se o servidor for gratuito) |
| Limites | Nenhum | Cotas mensais de banda e execução de funções (ver página da Vercel) | Do servidor |
| Ao ultrapassar | — | No Hobby o projeto é limitado/pausado, sem cobrança; Pro custa ~US$ 20/usuário/mês | — |
| 30 min / 1 h de vídeo | US$ 0 / US$ 0 | US$ 0 / US$ 0 (o vídeo vai direto ao storage, não passa pela Vercel) | US$ 0 / US$ 0 |
| Alternativa open source | — | Rodar `next start` em qualquer servidor | — |

## 5. Hospedagem do worker (FFmpeg + IA local)

| | Seu computador | Oracle Cloud **Always Free** |
|---|---|---|
| Plano gratuito? | Sim | Sim — 4 núcleos ARM Ampere, **24 GB RAM**, 200 GB de disco, 10 TB/mês de saída |
| Limites | Seu hardware | Fixos (instâncias Always Free); disponibilidade de ARM varia por região |
| Ao ultrapassar | — | Contas Always Free não cobram; só há cobrança se você converter a conta para "Pay As You Go". ⚠️ O cadastro pede cartão para verificação de identidade |
| 30 min / 1 h de vídeo | US$ 0 / US$ 0 | US$ 0 / US$ 0 |
| Observação | Ideal para desenvolver e testar | Cabe Supabase self-hosted + site + worker + faster-whisper + Ollama 7–8B na mesma VM |

Renderização (FFmpeg, sempre local e gratuita): com `X264_PRESET=veryfast`, cada corte de ~45 s leva ~10–40 s de CPU em 4 núcleos.

## 6. Outros

| Serviço | Gratuito? | Observação |
|---|---|---|
| GitHub (código) | Sim | Repositórios privados gratuitos |
| FFmpeg, OpenCV, faster-whisper, Ollama | Sim, open source | Sem custo de licença |
| Fontes das legendas (Google Fonts) | Sim, licença OFL | |
| E-mails de autenticação | Sim | Supabase local mostra os e-mails num painel local; o hospedado Free tem SMTP embutido com poucos envios/hora (suficiente para testes) |

---

## Resumo: quanto custa processar um vídeo

| Configuração | 30 min | 1 h | Observação |
|---|---|---|---|
| **A. 100% local** (Supabase local + faster-whisper + heurística ou Ollama) — **padrão** | **US$ 0** | **US$ 0** | Só usa seu computador. Mais lento |
| **B. Local + APIs com plano gratuito** (Groq transcrição + Gemini/Groq análise) | **US$ 0** | **US$ 0** | Mais rápido e melhor qualidade de cortes; sujeito aos limites diários |
| **C. Nuvem gratuita** (Oracle Always Free rodando tudo) | **US$ 0** | **US$ 0** | Exige configurar a VM; cartão só para verificação |
| D. Referência paga (OpenAI + Claude Opus 5.5) — **bloqueada por padrão** | ~US$ 0,30–0,50 | ~US$ 0,60–0,90 | Só com `ALLOW_PAID_PROVIDERS=true` |

**Recomendação para o MVP:** comece com **A** para desenvolver; quando quiser avaliar a qualidade dos cortes com IA de verdade, use **B** (crie as chaves do Groq e do Gemini **sem cadastrar cartão/ativar faturamento**, assim não há como ser cobrado).

## Fontes

- Groq — limites do plano gratuito e preços: https://eesel.ai/blog/groq-pricing · https://www.mintlify.com/cheahjs/free-llm-api-resources/providers/free/groq · https://groq.com/whisper-large-v3-turbo-now-available-on-groq-combining-speed-quality-for-speech-recognition/
- Gemini — plano gratuito: https://agentdeals.dev/gemini-api-pricing-changes · https://www.costbench.com/software/llm-api-providers/google-gemini-api/free-plan/
- Supabase — planos e limites: https://supabase.com/pricing · https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/
- OpenAI Whisper: https://convertaudiototext.com/blog/openai-whisper-api-pricing-2026
- Cloudflare R2: https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/
- Oracle Always Free: https://medium.com/@imvinojanv/setup-always-free-vps-with-4-ocpu-24gb-ram-and-200gb-storage-the-ultimate-oracle-cloud-guide-bed5cbf73d34
- Anthropic: preços oficiais por milhão de tokens (Opus 5.5 US$ 4/20, Sonnet 5.5 US$ 2/10, Haiku 4.5 US$ 1/5)
