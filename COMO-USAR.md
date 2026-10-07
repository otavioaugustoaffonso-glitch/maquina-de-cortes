# Como usar a Máquina de Cortes

Tudo é **gratuito** e roda no **seu computador**: sem conta paga, sem chave de API, sem cartão.

---

## Passo 1 — Instale 4 programas gratuitos (uma vez só)

| Programa | Link | Observação |
|---|---|---|
| **Node.js 22** | https://nodejs.org | Baixe a versão "LTS" |
| **Docker Desktop** | https://www.docker.com/products/docker-desktop | Depois de instalar, **abra o programa** e espere aparecer "Engine running" |
| **Python 3** | https://www.python.org/downloads | No Windows, marque **"Add Python to PATH"** na primeira tela do instalador |
| **ffmpeg** | https://ffmpeg.org/download.html | Windows: abra o PowerShell e rode `winget install ffmpeg`. Mac: `brew install ffmpeg`. Linux: `sudo apt install ffmpeg` |

Depois de instalar, **reinicie o computador** (para o Windows reconhecer os programas novos).

## Passo 2 — Rode o instalador (uma vez só)

Com o **Docker Desktop aberto**:

- **Windows:** dê dois cliques em **`instalar.bat`**
- **Mac / Linux:** abra o Terminal nesta pasta e rode `./instalar.sh`

O instalador verifica os programas, baixa o que falta, liga o banco de dados local e preenche as configurações sozinho. Na primeira vez leva de **5 a 20 minutos**, dependendo da internet. No final aparece **"Pronto!"**.

Se aparecer **"Faltam programas"**, instale o que ele indicar e rode o instalador de novo.

## Passo 3 — Ligue o site (sempre que for usar)

Com o **Docker Desktop aberto**:

- **Windows:** dois cliques em **`iniciar.bat`**
- **Mac / Linux:** `./iniciar.sh`

O navegador abre sozinho em **http://localhost:3000**. Se não abrir, digite esse endereço no navegador.

**Deixe a janela preta aberta** enquanto usa o site: é ela que processa os vídeos. Para desligar, feche a janela (ou aperte `Ctrl + C`).

## Passo 4 — Use o site

1. Clique em **Começar grátis** e crie sua conta (nome, e-mail e senha). A conta fica só no seu computador.
2. Clique em **Novo projeto**.
3. **Arraste o vídeo** (MP4, MOV, WEBM ou MKV) para a área indicada.
4. Escolha o idioma, o formato (**9:16** para Reels, TikTok e Shorts) e o estilo da legenda.
5. Clique em **Enviar e gerar cortes**. A tela mostra cada etapa: *Extraindo áudio → Transcrevendo → Analisando → Gerando cortes → Concluído*.
6. Os cortes aparecem **do melhor para o pior**, com uma nota de 0 a 100. Clique num corte para assistir e ver o gancho, a justificativa e a legenda sugerida para o post.
7. Para ajustar, clique no **lápis**: dá para mudar início e fim, texto e estilo da legenda, título e formato. Depois clique em **Regenerar corte**.
8. Clique em **Aprovar** nos cortes que gostar.
9. Baixe um corte pelo ícone de download, ou todos de uma vez em **Baixar aprovados** / **Baixar todos** (vem um .zip com os vídeos, as capas e um arquivo com títulos, legendas e hashtags).

## Quanto tempo demora

- **Primeiro vídeo:** a transcrição baixa um modelo de reconhecimento de fala (uns 500 MB), então demora mais.
- **Vídeo de 30 minutos:** a transcrição leva uns 10 a 25 minutos num computador comum. **Vídeo de 1 hora:** uns 20 a 50 minutos.
- Cada corte leva alguns segundos para ser gerado.

Pode fechar a aba do navegador enquanto processa; só não feche a janela preta.

## Cortes melhores com IA (opcional e gratuito)

Sem isso, a escolha dos cortes usa regras simples (qualidade básica). Para a IA escolher:

1. Instale o **Ollama**: https://ollama.com/download
2. No terminal, rode: `ollama pull qwen2.5:7b` (baixa uns 5 GB; precisa de uns 8 GB de memória RAM livre)
3. Rode o **instalador** de novo: ele detecta o Ollama e ativa a IA sozinho.

## Problemas comuns

| Problema | Solução |
|---|---|
| "Docker Desktop aberto" na lista do que falta | Abra o Docker Desktop, espere ficar pronto e rode de novo |
| "ffmpeg" ou "Python" na lista do que falta, mas você instalou | Reinicie o computador e rode de novo |
| O site abre mas o vídeo fica parado em "Na fila" | A janela preta do `iniciar` foi fechada; abra de novo |
| Transcrição muito lenta | Abra o arquivo `.env`, troque `LOCAL_WHISPER_MODEL=small` por `LOCAL_WHISPER_MODEL=base` e reinicie |
| Computador travando | Feche outros programas; no `.env`, use `MAX_AUTO_RENDER=5` |

Se aparecer outro erro, copie a mensagem da janela preta e me envie.

## Desligar tudo

Feche a janela do `iniciar`. Para desligar também o banco de dados (libera memória), rode no terminal: `npx supabase stop`. Seus projetos e vídeos continuam salvos.
