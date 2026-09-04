-- Jason Sync Protocol 1.0. Business facts only; secrets, caches, FTS and dashboards are excluded.
create table if not exists public.jason_sync_mutations (
  mutation_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  device_id uuid not null,
  transaction_id uuid,
  entity_type text not null,
  entity_id text not null,
  operation text not null check (operation in ('CREATE','UPDATE','DELETE','RELATION_ADD','RELATION_REMOVE')),
  base_revision bigint not null,
  changed_fields jsonb not null default '[]',
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.jason_sync_entities (
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  revision bigint not null,
  deleted_at timestamptz,
  primary key(owner_id,workspace_id,entity_type,entity_id)
);

create table if not exists public.jason_sync_change_log (
  server_sequence bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  operation text not null,
  server_revision bigint not null,
  payload jsonb not null,
  mutation_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists jason_sync_delta_idx on public.jason_sync_change_log(owner_id,workspace_id,server_sequence);

create table if not exists public.jason_sync_conflicts (
  conflict_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  local_revision bigint not null,
  server_revision bigint not null,
  fields jsonb not null,
  local_payload jsonb not null,
  remote_payload jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

alter table public.jason_sync_mutations enable row level security;
alter table public.jason_sync_entities enable row level security;
alter table public.jason_sync_change_log enable row level security;
alter table public.jason_sync_conflicts enable row level security;
create policy "owner mutations" on public.jason_sync_mutations for select using(owner_id=auth.uid());
create policy "owner entities" on public.jason_sync_entities for select using(owner_id=auth.uid());
create policy "owner changes" on public.jason_sync_change_log for select using(owner_id=auth.uid());
create policy "owner conflicts" on public.jason_sync_conflicts for select using(owner_id=auth.uid());

-- The push endpoint is deliberately a security-definer RPC so a client can never choose owner_id.
-- It is idempotent by mutation_id and uses base_revision, never device timestamps.
create or replace function public.jason_sync_push_v1(p_workspace_id uuid,p_device_id uuid,p_mutations jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner uuid:=auth.uid(); m jsonb; current_row public.jason_sync_entities%rowtype; next_revision bigint; sequence bigint; item jsonb; output jsonb:='[]';
begin
  if owner is null then raise exception 'authentication required'; end if;
  for m in select value from jsonb_array_elements(coalesce(p_mutations,'[]')) loop
    select result into item from public.jason_sync_mutations where mutation_id=(m->>'mutationId')::uuid and owner_id=owner;
    if found then output:=output||jsonb_build_array(item); continue; end if;
    select * into current_row from public.jason_sync_entities where owner_id=owner and workspace_id=p_workspace_id and entity_type=m->>'entityType' and entity_id=m->>'entityId' for update;
    if found and (m->>'baseRevision')::bigint<>current_row.revision and m->>'operation' not in ('DELETE','RELATION_REMOVE') then
      item:=jsonb_build_object('mutationId',m->>'mutationId','status','CONFLICT','serverRevision',current_row.revision);
    else
      next_revision:=coalesce(current_row.revision,0)+1;
      insert into public.jason_sync_entities(owner_id,workspace_id,entity_type,entity_id,payload,revision,deleted_at)
      values(owner,p_workspace_id,m->>'entityType',m->>'entityId',m->'payload',next_revision,case when m->>'operation' in ('DELETE','RELATION_REMOVE') then now() else null end)
      on conflict(owner_id,workspace_id,entity_type,entity_id) do update set payload=excluded.payload,revision=excluded.revision,deleted_at=excluded.deleted_at;
      insert into public.jason_sync_change_log(owner_id,workspace_id,entity_type,entity_id,operation,server_revision,payload,mutation_id)
      values(owner,p_workspace_id,m->>'entityType',m->>'entityId',m->>'operation',next_revision,m->'payload',(m->>'mutationId')::uuid) returning server_sequence into sequence;
      item:=jsonb_build_object('mutationId',m->>'mutationId','status','APPLIED','serverRevision',next_revision,'serverSequence',sequence);
    end if;
    insert into public.jason_sync_mutations(mutation_id,owner_id,workspace_id,device_id,transaction_id,entity_type,entity_id,operation,base_revision,changed_fields,result)
    values((m->>'mutationId')::uuid,owner,p_workspace_id,p_device_id,nullif(m->>'transactionId','')::uuid,m->>'entityType',m->>'entityId',m->>'operation',(m->>'baseRevision')::bigint,coalesce(m->'changedFields','[]'),item);
    output:=output||jsonb_build_array(item);
  end loop;
  return output;
end $$;
revoke all on function public.jason_sync_push_v1(uuid,uuid,jsonb) from public;
grant execute on function public.jason_sync_push_v1(uuid,uuid,jsonb) to authenticated;
