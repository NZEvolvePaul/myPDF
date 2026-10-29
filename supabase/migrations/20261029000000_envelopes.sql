-- Send-for-signature data model.
-- Senders sign in and manage their own envelopes through row-level security.
-- Signers never sign in: they reach the "signing" edge function with a secret
-- link token, and that function uses the service role.

create table public.envelopes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (length(title) between 1 and 200),
  message text check (length(message) <= 2000),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'completed', 'declined', 'voided')),
  original_path text not null,
  original_sha256 text,
  final_path text,
  final_sha256 text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz
);

create table public.recipients (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.envelopes on delete cascade,
  name text not null check (length(name) between 1 and 200),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  routing_order int not null default 1 check (routing_order >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'viewed', 'signed', 'declined')),
  token_hash text unique,
  consented_at timestamptz,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  declined_reason text,
  created_at timestamptz not null default now()
);

create table public.fields (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.envelopes on delete cascade,
  recipient_id uuid not null references public.recipients on delete cascade,
  kind text not null check (kind in ('signature', 'initials', 'date', 'text')),
  page int not null check (page >= 0),
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  w double precision not null check (w > 0 and w <= 1),
  h double precision not null check (h > 0 and h <= 1),
  required boolean not null default true,
  value text
);

-- Append-only: only the service role writes, and nobody updates or deletes.
create table public.audit_events (
  id bigint generated always as identity primary key,
  envelope_id uuid not null references public.envelopes on delete cascade,
  recipient_id uuid references public.recipients on delete set null,
  actor_email text,
  event text not null,
  ip text,
  user_agent text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index on public.envelopes (owner_id, created_at desc);
create index on public.recipients (envelope_id);
create index on public.fields (envelope_id);
create index on public.audit_events (envelope_id, created_at);

alter table public.envelopes enable row level security;
alter table public.recipients enable row level security;
alter table public.fields enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.owns_envelope(eid uuid, require_draft boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from envelopes e
    where e.id = eid and e.owner_id = auth.uid()
      and (not require_draft or e.status = 'draft')
  );
$$;

-- Envelopes: owners read theirs; they may only create and edit drafts.
-- Status changes after sending happen in edge functions.
create policy "owners read envelopes" on public.envelopes
  for select using (owner_id = auth.uid());
create policy "owners create drafts" on public.envelopes
  for insert with check (owner_id = auth.uid() and status = 'draft');
create policy "owners edit drafts" on public.envelopes
  for update using (owner_id = auth.uid() and status = 'draft')
  with check (owner_id = auth.uid() and status = 'draft');
create policy "owners delete drafts" on public.envelopes
  for delete using (owner_id = auth.uid() and status = 'draft');

create policy "owners read recipients" on public.recipients
  for select using (public.owns_envelope(envelope_id));
create policy "owners write draft recipients" on public.recipients
  for all using (public.owns_envelope(envelope_id, true))
  with check (public.owns_envelope(envelope_id, true) and status = 'pending' and token_hash is null);

create policy "owners read fields" on public.fields
  for select using (public.owns_envelope(envelope_id));
create policy "owners write draft fields" on public.fields
  for all using (public.owns_envelope(envelope_id, true))
  with check (public.owns_envelope(envelope_id, true) and value is null);

create policy "owners read audit" on public.audit_events
  for select using (public.owns_envelope(envelope_id));

-- Owners never see signers' link tokens.
revoke select on public.recipients from authenticated, anon;
grant select (id, envelope_id, name, email, routing_order, status, consented_at, signed_at,
  signed_ip, signed_user_agent, declined_reason, created_at) on public.recipients to authenticated;

-- Private bucket. Files live under "<owner id>/<envelope id>/".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

create policy "owners upload documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners read documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
-- Files of sent envelopes are evidence, so only drafts' files can be deleted.
create policy "owners delete draft documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.envelopes e
      where e.owner_id = auth.uid() and e.status <> 'draft'
        and (e.original_path = storage.objects.name or e.final_path = storage.objects.name)
    )
  );
