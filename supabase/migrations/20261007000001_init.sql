-- =============================================================================
-- Máquina de Cortes — schema inicial
-- Tabelas: profiles, projects, videos, transcripts, clips, exports, jobs,
--          usage_events
-- Todas com Row Level Security. O worker usa a service_role (bypassa RLS).
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.video_status as enum (
  'uploading',          -- Enviando vídeo...
  'queued',             -- Na fila
  'extracting_audio',   -- Extraindo áudio...
  'transcribing',       -- Transcrevendo...
  'analyzing',          -- Analisando conteúdo...
  'finding_moments',    -- Encontrando melhores momentos...
  'generating_clips',   -- Gerando cortes...
  'adding_captions',    -- Adicionando legendas...
  'finalizing',         -- Finalizando...
  'completed',          -- Concluído.
  'failed'
);

create type public.clip_status as enum (
  'suggested',  -- sugerido pela IA, ainda não renderizado
  'queued',     -- na fila de renderização
  'rendering',  -- renderizando
  'ready',      -- renderizado, aguardando revisão
  'approved',   -- aprovado pelo usuário
  'failed'
);

create type public.job_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.job_type as enum ('process_video', 'render_clip', 'export_zip');
create type public.export_status as enum ('queued', 'processing', 'ready', 'failed', 'expired');

-- -----------------------------------------------------------------------------
-- Helper: updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- profiles (1:1 com auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  full_name     text,
  avatar_url    text,
  -- preparação para planos pagos / créditos
  plan          text not null default 'free',
  credits_seconds integer not null default 3600, -- segundos de vídeo processáveis
  -- preferências padrão do usuário (estilo de legenda, idioma...)
  preferences   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria o profile automaticamente no cadastro
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- O usuário não pode alterar o próprio plano/créditos pelo client.
create or replace function public.protect_profile_billing()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'authenticated' then
    new.plan = old.plan;
    new.credits_seconds = old.credits_seconds;
    new.email = old.email;
  end if;
  return new;
end $$;

create trigger profiles_protect_billing before update on public.profiles
  for each row execute function public.protect_profile_billing();

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  -- configurações do projeto: idioma, estilo de legenda padrão, formato...
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index projects_user_created_idx on public.projects (user_id, created_at desc);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- videos (vídeo original enviado)
-- -----------------------------------------------------------------------------
create table public.videos (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  original_filename text not null,
  storage_path      text not null unique,   -- bucket "videos"
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes > 0),
  duration_seconds  numeric(10, 3),
  width             integer,
  height            integer,
  fps               numeric(8, 3),
  proxy_path        text,                   -- preview leve (mp4 540p) no bucket "videos"
  audio_path        text,                   -- áudio extraído (mp3 mono 16kHz)
  status            public.video_status not null default 'uploading',
  progress          smallint not null default 0 check (progress between 0 and 100),
  status_message    text,
  error             text,
  processing_started_at  timestamptz,
  processing_finished_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index videos_project_idx on public.videos (project_id);
create index videos_user_idx on public.videos (user_id, created_at desc);
create trigger videos_updated_at before update on public.videos
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- transcripts (1 por vídeo; palavras com timestamps)
-- -----------------------------------------------------------------------------
create table public.transcripts (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null unique references public.videos (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  provider    text not null,
  model       text,
  language    text,
  text        text not null,
  -- [{ "s": 0.0, "e": 4.2, "t": "frase..." }]
  segments    jsonb not null default '[]'::jsonb,
  -- [{ "w": "palavra", "s": 0.0, "e": 0.3 }]
  words       jsonb not null default '[]'::jsonb,
  duration_seconds numeric(10, 3),
  created_at  timestamptz not null default now()
);
create index transcripts_user_idx on public.transcripts (user_id);

-- -----------------------------------------------------------------------------
-- clips (cortes sugeridos/gerados)
-- -----------------------------------------------------------------------------
create table public.clips (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  video_id           uuid not null references public.videos (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  rank               integer not null default 0,     -- posição por score (1 = melhor)
  status             public.clip_status not null default 'suggested',
  render_stage       text,                            -- etapa atual da renderização
  -- tempos no vídeo original (segundos)
  start_time         numeric(10, 3) not null check (start_time >= 0),
  end_time           numeric(10, 3) not null,
  -- conteúdo gerado pela IA
  title              text not null default '',
  description        text not null default '',
  hook               text not null default '',
  reason             text not null default '',
  category           text,
  retention_potential text,
  keywords           text[] not null default '{}',
  hashtags           text[] not null default '{}',
  social_caption     text not null default '',        -- legenda sugerida para o post
  -- pontuação 0..100 e detalhamento
  score              smallint not null default 0 check (score between 0 and 100),
  score_breakdown    jsonb not null default '{}'::jsonb,
  -- edição
  caption_style      jsonb not null default '{}'::jsonb,
  caption_words      jsonb,                           -- override das palavras editadas
  format             jsonb not null default '{"aspect":"9:16","layout":"fill"}'::jsonb,
  remove_silences    boolean not null default true,
  show_title         boolean not null default true,
  title_on_screen    text,
  -- saída
  output_path        text,                            -- bucket "clips"
  thumbnail_path     text,                            -- bucket "clips"
  output_size_bytes  bigint,
  output_duration_seconds numeric(10, 3),
  framing            jsonb,                           -- trilha de enquadramento calculada
  render_error       text,
  rendered_at        timestamptz,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint clips_time_order check (end_time > start_time),
  constraint clips_max_duration check (end_time - start_time <= 600)
);
create index clips_project_rank_idx on public.clips (project_id, rank);
create index clips_user_status_idx on public.clips (user_id, status);
create trigger clips_updated_at before update on public.clips
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- exports (pacotes .zip para download em lote)
-- -----------------------------------------------------------------------------
create table public.exports (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  clip_ids      uuid[] not null,
  status        public.export_status not null default 'queued',
  storage_path  text,                                 -- bucket "exports"
  size_bytes    bigint,
  error         text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index exports_project_idx on public.exports (project_id, created_at desc);
create trigger exports_updated_at before update on public.exports
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- jobs (fila de processamento em background — consumida pelo worker)
-- -----------------------------------------------------------------------------
create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users (id) on delete cascade,
  type          public.job_type not null,
  payload       jsonb not null default '{}'::jsonb,
  status        public.job_status not null default 'queued',
  priority      smallint not null default 100,         -- menor = mais prioritário
  attempts      smallint not null default 0,
  max_attempts  smallint not null default 3,
  run_at        timestamptz not null default now(),
  locked_at     timestamptz,
  locked_by     text,
  heartbeat_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index jobs_claim_idx on public.jobs (status, priority, run_at) where status = 'queued';
create index jobs_running_idx on public.jobs (heartbeat_at) where status = 'running';
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- Reivindica atomicamente o próximo job disponível (FOR UPDATE SKIP LOCKED).
-- Vários workers podem rodar em paralelo sem processar o mesmo job.
create or replace function public.claim_job(p_worker text, p_types public.job_type[] default null)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_at = now(),
         heartbeat_at = now(),
         locked_by = p_worker
   where j.id = (
     select id from public.jobs
      where status = 'queued'
        and run_at <= now()
        and (p_types is null or type = any (p_types))
      order by priority, run_at
      for update skip locked
      limit 1
   )
  returning j.*;
end $$;

-- Recoloca na fila jobs cujo worker morreu (sem heartbeat).
create or replace function public.requeue_stale_jobs(p_timeout_seconds integer default 600)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.jobs
     set status = case when attempts >= max_attempts then 'failed'::public.job_status else 'queued'::public.job_status end,
         last_error = coalesce(last_error, '') || ' [worker sem heartbeat]',
         locked_at = null,
         locked_by = null,
         finished_at = case when attempts >= max_attempts then now() else null end
   where status = 'running'
     and heartbeat_at < now() - make_interval(secs => p_timeout_seconds);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.claim_job(text, public.job_type[]) from public, anon, authenticated;
revoke all on function public.requeue_stale_jobs(integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- usage_events (consumo: minutos transcritos, tokens de IA, segundos renderizados)
-- Base para créditos/planos pagos e controle de custos.
-- -----------------------------------------------------------------------------
create table public.usage_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  video_id    uuid references public.videos (id) on delete set null,
  kind        text not null,       -- 'transcription_seconds' | 'llm_input_tokens' | 'llm_output_tokens' | 'render_seconds'
  amount      numeric not null,
  provider    text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index usage_events_user_idx on public.usage_events (user_id, created_at desc);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles     enable row level security;
alter table public.projects     enable row level security;
alter table public.videos       enable row level security;
alter table public.transcripts  enable row level security;
alter table public.clips        enable row level security;
alter table public.exports      enable row level security;
alter table public.jobs         enable row level security;
alter table public.usage_events enable row level security;

-- profiles: cada um vê/edita apenas o seu
create policy "profiles_select_own" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- projects: CRUD apenas do dono
create policy "projects_select_own" on public.projects for select to authenticated
  using (user_id = (select auth.uid()));
create policy "projects_insert_own" on public.projects for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "projects_update_own" on public.projects for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "projects_delete_own" on public.projects for delete to authenticated
  using (user_id = (select auth.uid()));

-- videos: leitura e exclusão pelo dono. Inserção/atualização somente pelo backend
-- (API com service role) para impedir que o client altere status/caminhos.
create policy "videos_select_own" on public.videos for select to authenticated
  using (user_id = (select auth.uid()));
create policy "videos_delete_own" on public.videos for delete to authenticated
  using (user_id = (select auth.uid()));

-- transcripts: somente leitura
create policy "transcripts_select_own" on public.transcripts for select to authenticated
  using (user_id = (select auth.uid()));

-- clips: leitura, exclusão; atualização passa pela API (validação), mas
-- permitimos update direto do dono apenas para campos editáveis via trigger abaixo.
create policy "clips_select_own" on public.clips for select to authenticated
  using (user_id = (select auth.uid()));
create policy "clips_delete_own" on public.clips for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "clips_update_own" on public.clips for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Impede que o client altere campos de saída/sistema dos cortes.
create or replace function public.protect_clip_system_fields()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'authenticated' then
    new.id = old.id;
    new.user_id = old.user_id;
    new.project_id = old.project_id;
    new.video_id = old.video_id;
    new.output_path = old.output_path;
    new.thumbnail_path = old.thumbnail_path;
    new.output_size_bytes = old.output_size_bytes;
    new.output_duration_seconds = old.output_duration_seconds;
    new.framing = old.framing;
    new.render_error = old.render_error;
    new.rendered_at = old.rendered_at;
    new.render_stage = old.render_stage;
    new.score = old.score;
    new.score_breakdown = old.score_breakdown;
    new.rank = old.rank;
    -- status: o client só pode alternar entre ready <-> approved
    if new.status is distinct from old.status
       and not (old.status in ('ready', 'approved') and new.status in ('ready', 'approved')) then
      new.status = old.status;
    end if;
  end if;
  return new;
end $$;

create trigger clips_protect_system_fields before update on public.clips
  for each row execute function public.protect_clip_system_fields();

-- exports: leitura pelo dono
create policy "exports_select_own" on public.exports for select to authenticated
  using (user_id = (select auth.uid()));

-- jobs: o usuário só consegue ver o status dos próprios jobs (sem payload sensível)
create policy "jobs_select_own" on public.jobs for select to authenticated
  using (user_id = (select auth.uid()));

-- usage_events: leitura pelo dono
create policy "usage_select_own" on public.usage_events for select to authenticated
  using (user_id = (select auth.uid()));

-- =============================================================================
-- Estatísticas do dashboard (security invoker => respeita RLS)
-- =============================================================================
create or replace function public.dashboard_stats()
returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'projects',         (select count(*) from projects),
    'videos_processed', (select count(*) from videos where status = 'completed'),
    'videos_processing',(select count(*) from videos where status not in ('completed', 'failed', 'uploading')),
    'clips_total',      (select count(*) from clips),
    'clips_approved',   (select count(*) from clips where status = 'approved'),
    'clips_pending',    (select count(*) from clips where status in ('suggested', 'queued', 'rendering', 'ready')),
    'storage_bytes',    coalesce((select sum(size_bytes) from videos), 0)
                        + coalesce((select sum(output_size_bytes) from clips), 0)
                        + coalesce((select sum(size_bytes) from exports where status = 'ready'), 0),
    'minutes_processed', coalesce((select round(sum(duration_seconds) / 60.0, 1) from videos where status = 'completed'), 0)
  );
$$;

grant execute on function public.dashboard_stats() to authenticated;
