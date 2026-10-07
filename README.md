# Máquina de Cortes

Plataforma SaaS que transforma vídeos longos (podcasts, aulas, lives, entrevistas) em vários vídeos curtos prontos para **TikTok, Instagram Reels e YouTube Shorts**.

O usuário envia um vídeo → o sistema extrai o áudio, transcreve com timestamps por palavra, usa IA para encontrar os melhores momentos, pontua cada um (0–100) e gera automaticamente cortes verticais 1080×1920 com legendas animadas, título na tela e thumbnail. Depois é só revisar, editar, aprovar e baixar (individualmente ou em .zip).

## Funcionalidades

- **Upload de vídeos grandes** (MP4, MOV, WEBM, MKV): arrastar e soltar, progresso, velocidade, tempo restante, cancelar, retomada automática (TUS direto para o Storage).
- **Processamento em segundo plano** com status em tempo real: *Enviando vídeo → Extraindo áudio → Transcrevendo → Analisando conteúdo → Encontrando melhores momentos → Gerando cortes → Adicionando legendas → Finalizando → Concluído*.
- **IA de cortes**: ganchos, histórias, dicas, polêmicas, humor, emoção, perguntas e respostas; cada corte faz sentido sozinho e começa direto na parte interessante. Para cada corte: início, fim, duração, título, descrição, gancho, justificativa, potencial de retenção, palavras-chave, legenda sugerida e hashtags.
- **Score 0–100** combinando IA (gancho, clareza, valor, emoção, curiosidade, contexto) e métricas locais da fala (ritmo, pausas, vícios de linguagem). Melhores cortes primeiro.
- **Edição automática**: remoção de pausas e introduções vazias, enquadramento 9:16 seguindo o rosto, fundo desfocado opcional, legendas palavra a palavra, destaque de palavras-chave, título na tela, thumbnail, áudio normalizado.
- **5 estilos de legenda** (minimalista, destaque de palavras, viral, podcast, clean) com fonte, tamanho, posição, cor, cor de destaque, fundo, opacidade e animação editáveis.
- **Editor simples**: ajustar início/fim (campos, timeline arrastável, transcrição clicável), editar texto da legenda, título, descrição, hashtags, formato (9:16, 4:5, 1:1, 16:9), pré-visualização ao vivo fiel ao resultado, regenerar, aprovar, excluir.
- **Dashboard**: novo projeto, projetos recentes, vídeos processados, cortes gerados/aprovados/pendentes, armazenamento usado.
- **Exportação**: download individual (MP4 H.264/AAC) ou pacote .zip com cortes, capas e arquivo de legendas/hashtags.
- **Contas**: cadastro, login, logout, recuperação de senha, perfil. Cada usuário vê apenas os próprios dados (RLS).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage, RLS) · FFmpeg · OpenCV · Anthropic Claude (análise) · OpenAI/Groq Whisper (transcrição).

## Documentação

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitetura, pipeline, score, modelo de dados, segurança, extensibilidade.
- [docs/SETUP.md](docs/SETUP.md) — passo a passo de cada serviço externo (onde criar conta, onde obter a chave, variáveis, custos e alternativas gratuitas), hospedagem e execução local.

## Início rápido

```bash
npm install
cp .env.example .env.local   # preencha Supabase + chaves de IA (veja docs/SETUP.md)
cp .env.example .env         # mesmo conteúdo, usado pelo worker
# aplique supabase/migrations/*.sql no seu projeto Supabase
npm run fonts && pip install -r worker/requirements.txt
npm run dev                  # app em http://localhost:3000
npm run worker               # processamento (requer ffmpeg e python3)
```

## Testes

```bash
npm test            # testes unitários
npm run test:e2e    # pipeline de mídia ponta a ponta, local, sem custo de API
npm run typecheck && npm run lint && npm run build
```

O SQL de RLS pode ser validado com `supabase/tests/rls_smoke_test.sql`.

## Etapas do desenvolvimento

| # | Etapa | Status |
|---|---|---|
| 1 | Arquitetura | ✅ `docs/ARCHITECTURE.md` |
| 2 | Estrutura do projeto | ✅ |
| 3 | Configuração do Supabase | ✅ clients browser/server/admin, proxy de sessão |
| 4 | Banco de dados e RLS | ✅ `supabase/migrations` + teste de RLS |
| 5 | Autenticação | ✅ cadastro, login, logout, recuperação de senha, perfil |
| 6 | Dashboard | ✅ |
| 7 | Upload de vídeos | ✅ TUS resumable, cancelar, progresso |
| 8 | Processamento assíncrono | ✅ fila Postgres + worker com retry/heartbeat |
| 9 | Transcrição | ✅ OpenAI/Groq Whisper com timestamps por palavra |
| 10 | IA para identificação dos cortes | ✅ Claude com saída estruturada + score |
| 11 | FFmpeg | ✅ |
| 12 | Vídeos verticais | ✅ 9:16 com tracking de rosto |
| 13 | Legendas | ✅ ASS animado + 5 estilos |
| 14 | Editor | ✅ preview ao vivo + regenerar |
| 15 | Exportação/download | ✅ individual + .zip |
| 16 | Teste do fluxo completo | ✅ unitários, e2e de mídia, fluxo no navegador |

## Próximos passos sugeridos

Planos pagos e cobrança (Stripe), equipes/organizações, publicação automática (Instagram, TikTok, YouTube), analytics dos vídeos publicados, API pública, transcrição self-hosted (faster-whisper) e renderização com GPU. Os pontos de extensão estão descritos em `docs/ARCHITECTURE.md`.
