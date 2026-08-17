-- ============================================================
-- Deal Ledger — Project Management module migration
-- ------------------------------------------------------------
-- Run once. Safe to re-run.
--
-- A project can originate from a Won deal (deal_id set, client
-- details carried over) OR stand alone entirely — an external
-- project, an idea, R&D with no paying client yet (deal_id null,
-- client_name free-typed).
--
-- Phases/milestones and documents are stored as jsonb arrays,
-- same "computed structure, no separate table" pattern as
-- todos.subtasks/documents — a project's phases are only ever
-- queried in the context of that one project, so a join table
-- buys nothing here.
--
-- Tasks belonging to a project are NOT stored on the project row
-- — they're regular `todos` rows linked via the universal
-- `links` array (type='project', id=<project id>), same as every
-- other cross-module link in the app.
-- ============================================================

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'web',           -- 'web' | 'mobile' | 'systems' | 'consultation' | 'idea' | 'other'
  status text not null default 'not_started',  -- 'not_started' | 'in_progress' | 'on_hold' | 'completed' | 'delivered'
  deal_id uuid references deals(id) on delete set null,
  client_name text default '',
  description text default '',
  start_date text,
  target_date text,
  phases jsonb not null default '[]'::jsonb,     -- [{ id, name, status, dueDate }]
  documents jsonb not null default '[]'::jsonb,  -- same shape as deals.documents / todos.documents
  links jsonb not null default '[]'::jsonb,      -- can link to contacts/referrals/entities/invoices/custom too
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists projects_status_idx on projects (status);
create index if not exists projects_deal_id_idx on projects (deal_id);

alter table projects enable row level security;
drop policy if exists "projects_anon_all" on projects;
create policy "projects_anon_all" on projects for all using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects') then
    alter publication supabase_realtime add table projects;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_type_valid') then
    alter table projects add constraint projects_type_valid check (type in ('web', 'mobile', 'systems', 'consultation', 'idea', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_status_valid') then
    alter table projects add constraint projects_status_valid check (status in ('not_started', 'in_progress', 'on_hold', 'completed', 'delivered'));
  end if;
end $$;
