-- Run this once in the Supabase SQL editor.
-- pgvector indexes are limited to 2000 dimensions; Upstage embeddings are 4096,
-- so search uses exact cosine distance. That is fine for a small knowledge base.

create extension if not exists vector with schema extensions;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '새 대화',
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  content text not null,
  embedding extensions.vector(4096) not null,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_created_idx
  on public.conversations (user_id, created_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
create index if not exists documents_source_idx on public.documents (source);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "read documents" on public.documents;
create policy "read documents" on public.documents
  for select to authenticated
  using (true);

drop policy if exists "write documents" on public.documents;
create policy "write documents" on public.documents
  for insert to authenticated
  with check (true);

drop policy if exists "replace documents" on public.documents;
create policy "replace documents" on public.documents
  for delete to authenticated
  using (true);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, delete on public.documents to authenticated;

create or replace function public.match_documents(
  query_embedding extensions.vector(4096),
  match_count int default 4
)
returns table (
  id uuid,
  source text,
  content text,
  similarity float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    documents.id,
    documents.source,
    documents.content,
    (1 - (documents.embedding <=> query_embedding))::float as similarity
  from public.documents
  order by documents.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_documents(extensions.vector, int) to authenticated;
