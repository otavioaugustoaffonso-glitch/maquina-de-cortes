# Custos: tudo gratuito

O projeto só contém ferramentas gratuitas. As integrações pagas (OpenAI e Anthropic) foram **removidas do código**, então não existe configuração que gere cobrança dentro do sistema.

Há dois níveis de "gratuito":

- **100% gratuito e local (padrão):** software open source rodando na sua máquina. Não precisa de conta, chave, nem cartão, e nenhum dado sai do seu computador.
- **Plano gratuito em nuvem (opcional):** Groq e Gemini oferecem uso gratuito com limites. Crie as chaves **sem cadastrar cartão e sem ativar faturamento**: assim, ao atingir o limite, as requisições são apenas recusadas e o worker espera para tentar de novo.

> Limites pesquisados em outubro/2026 em fontes públicas (algumas não oficiais). Eles mudam: confira a página oficial antes de usar.

## Premissas das estimativas

- Fala em português: ~150 palavras/min → **30 min ≈ 12–15 mil tokens** de texto para a IA de análise; **1 h ≈ 25–30 mil**.
- Vídeo 1080p: **30 min ≈ 0,5–1,5 GB**; **1 h ≈ 1–3 GB**. Proxy de preview ≈ 75 MB a cada 30 min. Cada corte ≈ 5–25 MB.
- Tempos de CPU: estimativas para um computador de 4 núcleos; variam muito com o hardware.

## Por serviço

| Serviço | 1. Grátis? | 2. Limites | 3. Ao passar do limite | 4. Vídeo de 30 min | 5. Vídeo de 1 h | 6. Alternativa grátis |
|---|---|---|---|---|---|---|
| **Supabase local** (banco, login, arquivos) | Sim, open source | Seu disco e RAM; upload até 10 GiB (`supabase/config.toml`) | Sem cobrança | US$ 0 | US$ 0 | — |
| **faster-whisper** (transcrição, padrão) | Sim, open source (MIT) | Sua CPU; modelo `small` ≈ 1 GB de RAM | Sem cobrança, só fica mais lento | US$ 0 · ~10–25 min de CPU | US$ 0 · ~20–50 min de CPU | — |
| **Análise por regras** (padrão) | Sim, faz parte do projeto | Nenhum | — | US$ 0 · segundos | US$ 0 · segundos | — (qualidade básica) |
| **Ollama** (IA de análise local, recomendado) | Sim, open source | Sua RAM: modelo de 7–8B ≈ 6–8 GB; 14B ≈ 10–12 GB | Sem cobrança | US$ 0 · alguns minutos em CPU | US$ 0 · alguns minutos em CPU | — |
| **FFmpeg + OpenCV** (cortes, 9:16, legendas, rosto) | Sim, open source | Sua CPU; ~10–40 s por corte de 45 s | Sem cobrança | US$ 0 | US$ 0 | — |
| Groq (opcional: transcrição) | Sim, plano gratuito sem cartão | ~2 h de áudio por hora, ~8 h por dia, 20 req/min | Requisições recusadas; o worker espera | US$ 0 | US$ 0 | faster-whisper |
| Groq (opcional: análise, Llama 3.3 70B) | Sim, plano gratuito sem cartão | 12 mil tokens/min, ~100 mil tokens/dia | Requisições recusadas | US$ 0 (~3 chamadas) | US$ 0 (~6 chamadas; ~3 vídeos de 1 h por dia) | Ollama |
| Gemini Flash (opcional: análise) | Sim, sem ativar faturamento | Por projeto no AI Studio; ~15 req/min, ~1.500 req/dia | Requisições recusadas | US$ 0 | US$ 0 | Ollama |

⚠️ **Privacidade nos planos gratuitos em nuvem:** pelos termos do Google, o conteúdo enviado ao Gemini gratuito pode ser usado para melhorar os produtos deles. Para não enviar nada para fora, use só as opções locais.

## Onde rodar sem pagar

| Opção | Custo | Observação |
|---|---|---|
| **Seu computador** (recomendado para o MVP) | US$ 0 | Supabase local + site + worker + faster-whisper + Ollama. Requer Docker, Node, Python e ffmpeg |
| Site na Vercel Hobby | US$ 0 | Só para uso não comercial. O vídeo não passa pela Vercel |
| Oracle Cloud Always Free | US$ 0 | 4 núcleos ARM, 24 GB de RAM, 200 GB de disco. ⚠️ O cadastro pede cartão para verificação; não converta a conta para "Pay As You Go" |

**Não use o Supabase hospedado no plano Free para vídeos:** ele limita cada arquivo a 50 MB e o total a 1 GB, e um vídeo de 30 min passa disso. Use o Supabase local (ou instalado no seu próprio servidor).

## Resumo por vídeo

| Configuração | 30 min | 1 h | Qualidade dos cortes |
|---|---|---|---|
| **Padrão:** faster-whisper + regras | **US$ 0** | **US$ 0** | Básica |
| **Recomendado:** faster-whisper + Ollama | **US$ 0** | **US$ 0** | Boa (depende do modelo e da RAM) |
| Opcional em nuvem: Groq + Gemini/Groq, chaves sem cartão | **US$ 0** | **US$ 0** | Boa; sujeito a limites diários |

## Fontes

- Groq: https://eesel.ai/blog/groq-pricing · https://www.mintlify.com/cheahjs/free-llm-api-resources/providers/free/groq
- Gemini: https://agentdeals.dev/gemini-api-pricing-changes · https://www.costbench.com/software/llm-api-providers/google-gemini-api/free-plan/
- Supabase: https://supabase.com/pricing · https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/
- Oracle Always Free: https://medium.com/@imvinojanv/setup-always-free-vps-with-4-ocpu-24gb-ram-and-200gb-storage-the-ultimate-oracle-cloud-guide-bed5cbf73d34
- faster-whisper: https://github.com/SYSTRAN/faster-whisper · Ollama: https://ollama.com
