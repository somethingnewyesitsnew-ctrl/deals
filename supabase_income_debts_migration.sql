-- ============================================================
-- Deal Ledger — Income sources, Debts, and universal linking on
-- money entries (Module 1.6). Run once, after the previous two
-- todos migrations. Safe to re-run.
--
-- `expenses` gains:
--   recurring   text  — null | 'daily' | 'weekly' | 'monthly' | 'yearly'
--                        (mainly meaningful when kind='income' — a
--                        recurring retainer/external project payment)
--   links       jsonb  — same universal link shape as todos.links
--                        (link income/expenses to a deal, contact,
--                        referral, entity, invoice, or a free-typed
--                        tag — e.g. an external project with no deal)
-- Note: `category` doubles as "source" for income rows in the UI —
-- no new column needed there, just a different label/option set.
--
-- New table `debts` — money owed, either direction:
--   direction  'i_owe' | 'owed_to_me'
-- ============================================================

alter table expenses add column if not exists recurring text;
alter table expenses add column if not exists links jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_recurring_valid') then
    alter table expenses add constraint expenses_recurring_valid
      check (recurring is null or recurring in ('daily', 'weekly', 'monthly', 'yearly'));
  end if;
end $$;

create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  direction text not null default 'i_owe',   -- 'i_owe' | 'owed_to_me'
  amount numeric not null default 0,
  currency text not null default 'USD',
  counterparty text default '',
  due_date text,
  status text not null default 'open',        -- 'open' | 'paid'
  notes text default '',
  links jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  paid_at bigint
);
create index if not exists debts_status_idx on debts (status);
create index if not exists debts_due_date_idx on debts (due_date);

alter table debts enable row level security;
drop policy if exists "debts_anon_all" on debts;
create policy "debts_anon_all" on debts for all using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'debts') then
    alter publication supabase_realtime add table debts;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debts_direction_valid') then
    alter table debts add constraint debts_direction_valid check (direction in ('i_owe', 'owed_to_me'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debts_status_valid') then
    alter table debts add constraint debts_status_valid check (status in ('open', 'paid'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debts_currency_valid') then
    alter table debts add constraint debts_currency_valid check (currency in ('USD', 'SDG'));
  end if;
end $$;
