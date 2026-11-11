-- Forest Buddy: run this once in Supabase → SQL Editor → New query → Run.
-- If a line errors with "already exists", that step is already done — skip it.

-- 1. Turn on Row Level Security (RLS). With RLS on, nobody can read or write
--    a table unless a policy allows it.
alter table public.runs    enable row level security;
alter table public.records enable row level security;

-- 2. Let the public website READ both tables (read only — no insert/update/delete).
create policy "Public can read runs"
  on public.runs for select to anon using (true);

create policy "Public can read records"
  on public.records for select to anon using (true);

-- 3. Turn on live updates (Realtime) for both tables.
alter publication supabase_realtime add table public.records;
alter publication supabase_realtime add table public.runs;

-- NOTE on the robot/uploader:
--   If it uploads with the service_role (secret) key, it ignores RLS and keeps working.
--   If it uploads with the anon key, step 1 will block its inserts. Either switch it to
--   the secret key (kept on the robot, never on GitHub), or uncomment this:
--
-- create policy "Uploader can insert records"
--   on public.records for insert to anon with check (true);
--
--   (That second option means anyone with the public key could add rows.)

-- Your primary key (run_id, timestamp_ms) already works as an index for
-- "all records for run X, ordered by time", so no extra index is needed.
