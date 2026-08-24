-- Jason OS cloud replica. The SQLite database remains the local replica; this stores
-- user-scoped record envelopes and tombstones only. API keys are never written here.
create table if not exists public.jason_sync_devices (
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  last_seen_at timestamptz not null default now(),
  primary key (owner_id, device_id)
);

create table if not exists public.jason_sync_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_id text not null,
  entity text not null,
  payload jsonb not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  source_device_id uuid,
  primary key (owner_id, record_id)
);
create index if not exists jason_sync_records_owner_updated_idx on public.jason_sync_records(owner_id, updated_at asc);

create table if not exists public.jason_sync_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  record_id text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  updated_at bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists jason_sync_events_owner_created_idx on public.jason_sync_events(owner_id, created_at desc);

alter table public.jason_sync_devices enable row level security;
alter table public.jason_sync_records enable row level security;
alter table public.jason_sync_events enable row level security;

create policy "owners read their sync devices" on public.jason_sync_devices for select using (owner_id = auth.uid());
create policy "owners read their records" on public.jason_sync_records for select using (owner_id = auth.uid());
create policy "owners read their sync events" on public.jason_sync_events for select using (owner_id = auth.uid());

create or replace function public.jason_sync_upsert_records(p_changes jsonb, p_device_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_owner uuid := auth.uid();
  changed_count integer := 0;
  change jsonb;
  wrote boolean;
begin
  if current_owner is null then raise exception 'authentication required'; end if;
  insert into public.jason_sync_devices(owner_id, device_id) values (current_owner, p_device_id)
  on conflict (owner_id, device_id) do update set last_seen_at = now();
  for change in select value from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    wrote := false;
    insert into public.jason_sync_records(owner_id, record_id, entity, payload, created_at, updated_at, deleted_at, source_device_id)
    values (current_owner, change->>'record_id', change->>'entity', change->'payload', (change->>'created_at')::bigint, (change->>'updated_at')::bigint, nullif(change->>'deleted_at', '')::bigint, p_device_id)
    on conflict (owner_id, record_id) do update set
      entity = excluded.entity, payload = excluded.payload, updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at, source_device_id = excluded.source_device_id
    where excluded.updated_at > public.jason_sync_records.updated_at
    returning true into wrote;
    if coalesce(wrote, false) then
      changed_count := changed_count + 1;
      insert into public.jason_sync_events(owner_id, device_id, record_id, operation, updated_at)
      values (current_owner, p_device_id, change->>'record_id', case when change->>'deleted_at' is null then 'upsert' else 'delete' end, (change->>'updated_at')::bigint);
    end if;
  end loop;
  return changed_count;
end;
$$;

revoke all on function public.jason_sync_upsert_records(jsonb, uuid) from public;
grant execute on function public.jason_sync_upsert_records(jsonb, uuid) to authenticated;

-- Create a private bucket named `jason-notebook-files` in the Supabase dashboard.
-- Its object key must start with auth.uid() so Storage RLS can enforce user ownership.
