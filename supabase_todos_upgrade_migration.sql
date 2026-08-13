-- ============================================================
-- Deal Ledger — To-Do upgrade migration (Module 1.5)
-- ------------------------------------------------------------
-- Run this once, after the first todos migration. Safe to re-run.
--
-- Adds to `todos`:
--   links        jsonb  — universal link picker: deals, contacts,
--                          referrals, entities, invoices, or a
--                          free-typed custom tag. Shape per item:
--                          { type, id, label, dealId? }
--   subtasks     jsonb  — [{ id, text, done }]
--   documents    jsonb  — same shape as deals.documents (file/link)
--   amount       numeric, currency, money_kind ('expense'|'income')
--                — when set, storage.js auto-creates/updates a
--                  linked row in `expenses` (tagged via
--                  expenses.source_todo_id) so a to-do's money
--                  always shows up in Financial too.
--
-- Adds to `expenses`:
--   kind            text  — 'expense' (default) | 'income'
--   source_todo_id  uuid  — set only for expenses auto-created
--                           from a to-do; deleting the to-do
--                           deletes this row too.
-- ============================================================

alter table todos add column if not exists links jsonb not null default '[]'::jsonb;
alter table todos add column if not exists subtasks jsonb not null default '[]'::jsonb;
alter table todos add column if not exists documents jsonb not null default '[]'::jsonb;
alter table todos add column if not exists amount numeric;
alter table todos add column if not exists currency text;
alter table todos add column if not exists money_kind text;

alter table expenses add column if not exists kind text not null default 'expense';
alter table expenses add column if not exists source_todo_id uuid references todos(id) on delete cascade;
create index if not exists expenses_source_todo_idx on expenses (source_todo_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'todos_money_kind_valid') then
    alter table todos add constraint todos_money_kind_valid check (money_kind is null or money_kind in ('expense', 'income'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'todos_currency_valid') then
    alter table todos add constraint todos_currency_valid check (currency is null or currency in ('USD', 'SDG'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_kind_valid') then
    alter table expenses add constraint expenses_kind_valid check (kind in ('expense', 'income'));
  end if;
end $$;
