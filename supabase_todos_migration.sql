-- ============================================================
-- Deal Ledger — To-Do module migration
-- ------------------------------------------------------------
-- Run this once in the Supabase SQL Editor. Safe to re-run —
-- every statement is guarded (IF NOT EXISTS / drop-then-create
-- policy), matching the style of supabase_schema.sql.
--
-- `todos` are standalone tasks — personal admin work, ideas,
-- follow-ups — that CAN optionally link to a deal via deal_id,
-- but don't have to. This is the foundation the Daily Action
-- Center and the notification/reminder engine build on next.
-- ============================================================

create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text default '',
  due_date text,                          -- 'YYYY-MM-DD', nullable — same string-date convention as deals.closeDate
  priority text not null default 'normal', -- 'low' | 'normal' | 'high'
  status text not null default 'open',     -- 'open' | 'done'
  recurring text,                          -- null | 'daily' | 'weekly' | 'monthly'
  deal_id uuid references deals(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  completed_at bigint
);
create index if not exists todos_status_idx on todos (status);
create index if not exists todos_due_date_idx on todos (due_date);
create index if not exists todos_deal_id_idx on todos (deal_id);

alter table todos enable row level security;
drop policy if exists "todos_anon_all" on todos;
create policy "todos_anon_all" on todos for all using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'todos') then
    alter publication supabase_realtime add table todos;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'todos_priority_valid') then
    alter table todos add constraint todos_priority_valid check (priority in ('low', 'normal', 'high'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'todos_status_valid') then
    alter table todos add constraint todos_status_valid check (status in ('open', 'done'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'todos_recurring_valid') then
    alter table todos add constraint todos_recurring_valid check (recurring is null or recurring in ('daily', 'weekly', 'monthly'));
  end if;
end $$;
