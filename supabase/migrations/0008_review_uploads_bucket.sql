-- Private bucket where a browser sends a video straight to storage (hosted mode) before the
-- worker checks, converts and deletes it. Separate from review-media, which only takes the
-- finished MP4/JPEG/VTT files. No type list: MOV and WebM arrive here and are checked by their
-- bytes. Per-file size is left to the project's global storage limit (50 MB on the free plan;
-- raise it in Supabase Storage settings to match MAX_UPLOAD_MB). The app uses only the secret
-- key and signed upload URLs, so no policies are needed.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('review-uploads', 'review-uploads', false)
    on conflict (id) do nothing;
  end if;
end $$;
