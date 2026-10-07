-- Teste de fumaça de RLS. Execute em um banco com as migrations aplicadas.
-- (No Supabase local: supabase db reset && psql ... -f supabase/tests/rls_smoke_test.sql)
begin;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev');

insert into public.projects (id, user_id, name) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Projeto A'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Projeto B');
insert into public.videos (id, project_id, user_id, original_filename, storage_path, mime_type, size_bytes, status)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-00000000000a', 'a.mp4', 'a/x.mp4', 'video/mp4', 100, 'completed');
insert into public.clips (id, project_id, video_id, user_id, start_time, end_time, status, score, title)
values ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
        '20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 1, 30, 'ready', 80, 'T');

-- Usuário A autenticado
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare n int; s json;
begin
  select count(*) into n from public.projects;
  assert n = 1, 'A deve ver apenas 1 projeto, viu ' || n;
  select count(*) into n from public.profiles;
  assert n = 1, 'A deve ver apenas o próprio profile';

  -- não pode inserir projeto para outro usuário
  begin
    insert into public.projects (user_id, name) values ('00000000-0000-0000-0000-00000000000b', 'hack');
    raise exception 'insert indevido permitido';
  exception when insufficient_privilege then null;
  end;

  -- não pode inserir vídeo diretamente (somente backend)
  begin
    insert into public.videos (project_id, user_id, original_filename, storage_path, mime_type, size_bytes)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'b.mp4', 'a/y.mp4', 'video/mp4', 1);
    raise exception 'insert de vídeo pelo client permitido';
  exception when insufficient_privilege then null;
  end;

  -- campos de sistema protegidos; status só ready<->approved
  update public.clips set score = 100, output_path = 'hack', status = 'approved', title = 'Novo'
   where id = '30000000-0000-0000-0000-00000000000a';
  select json_build_object('score', score, 'out', output_path, 'status', status, 'title', title) into s
    from public.clips where id = '30000000-0000-0000-0000-00000000000a';
  assert (s->>'score')::int = 80 and s->>'out' is null and s->>'status' = 'approved' and s->>'title' = 'Novo',
    'proteção de campos falhou: ' || s::text;
  update public.clips set status = 'suggested' where id = '30000000-0000-0000-0000-00000000000a';
  assert (select status from public.clips where id = '30000000-0000-0000-0000-00000000000a') = 'approved',
    'status não deveria voltar para suggested';

  -- não pode alterar o próprio plano
  update public.profiles set plan = 'enterprise', credits_seconds = 999999, full_name = 'Ana';
  assert (select plan from public.profiles) = 'free', 'plano não deveria mudar';
  assert (select full_name from public.profiles) = 'Ana', 'nome deveria mudar';

  -- storage: só na própria pasta
  insert into storage.objects (bucket_id, name) values ('videos', '00000000-0000-0000-0000-00000000000a/p/v.mp4');
  begin
    insert into storage.objects (bucket_id, name) values ('videos', '00000000-0000-0000-0000-00000000000b/p/v.mp4');
    raise exception 'upload em pasta alheia permitido';
  exception when insufficient_privilege then null;
  end;

  s := public.dashboard_stats();
  assert (s->>'projects')::int = 1 and (s->>'clips_approved')::int = 1, 'stats incorretas: ' || s::text;
end $$;

-- Usuário B não vê nada de A
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  assert (select count(*) from public.clips) = 0, 'B não deveria ver cortes de A';
  assert (select count(*) from public.videos) = 0, 'B não deveria ver vídeos de A';
  delete from public.projects where id = '10000000-0000-0000-0000-00000000000a';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.projects where id = '10000000-0000-0000-0000-00000000000a') = 1, 'B apagou projeto de A';
end $$;

-- Fila: claim_job com SKIP LOCKED
insert into public.jobs (type, payload) values ('process_video', '{"n":1}'), ('render_clip', '{"n":2}');
do $$
declare j public.jobs;
begin
  select * into j from public.claim_job('w1', array['render_clip']::public.job_type[]);
  assert j.type = 'render_clip' and j.status = 'running' and j.attempts = 1, 'claim falhou';
  select * into j from public.claim_job('w1', null);
  assert j.type = 'process_video', 'segundo claim falhou';
  select * into j from public.claim_job('w1', null);
  assert j.id is null, 'fila deveria estar vazia';
end $$;
select 'RLS SMOKE TEST OK' as result;
rollback;
