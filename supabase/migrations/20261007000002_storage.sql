-- =============================================================================
-- Storage: buckets privados + políticas
-- Convenção de caminho: {user_id}/{project_id}/{arquivo}
--   videos  -> originais enviados pelo usuário (upload direto, resumable/TUS)
--              + proxy de preview e áudio extraído (escritos pelo worker)
--   clips   -> cortes renderizados e thumbnails (escritos pelo worker)
--   exports -> pacotes .zip (escritos pelo worker)
-- =============================================================================

-- Limite por arquivo: 10 GB. ATENÇÃO: no plano Free do Supabase o limite global
-- é 50 MB por arquivo; ajuste em Storage > Settings (planos Pro+ até 500 GB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('videos',  'videos',  false, 10737418240,
     array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'audio/mpeg']),
  ('clips',   'clips',   false, 2147483648,
     array['video/mp4', 'image/jpeg']),
  ('exports', 'exports', false, 10737418240,
     array['application/zip'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Upload: o usuário só pode enviar para a própria pasta no bucket "videos"
create policy "videos_insert_own_folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Necessário para o upload resumable (TUS) retomar/atualizar
create policy "videos_update_own_folder" on storage.objects for update to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Leitura (signed URLs) e exclusão apenas dos próprios arquivos
create policy "media_select_own_folder" on storage.objects for select to authenticated
  using (
    bucket_id in ('videos', 'clips', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "media_delete_own_folder" on storage.objects for delete to authenticated
  using (
    bucket_id in ('videos', 'clips', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
