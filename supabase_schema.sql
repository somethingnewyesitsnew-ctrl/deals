-- ============================================================
-- Deal Ledger — Supabase schema
-- ------------------------------------------------------------
-- Run this once in the Supabase SQL Editor (Project → SQL Editor
-- → New query → paste → Run). Safe to re-run: every statement is
-- guarded with IF NOT EXISTS / ON CONFLICT so re-running it won't
-- wipe existing data.
--
-- Design note: `deals` keeps every deal-specific field (entityName,
-- commLog, invoices, paymentBreakdown, documents, notes, etc.)
-- inside one `data jsonb` column instead of a fully normalized
-- relational schema. This mirrors exactly what the app already
-- stored as one JS object per deal in localStorage, so the
-- migration only touches storage.js instead of every file that
-- reads deal.commLog / deal.invoices / deal.documents as plain JS
-- arrays. `id`, `entry_index`, `created_at`, `updated_at` are
-- pulled out as real columns because the app sorts/filters on them
-- directly. `expenses` is a genuine top-level entity in the app
-- already (not deal-scoped), so it gets real columns.
-- ============================================================

create extension if not exists pgcrypto; -- gives us gen_random_uuid()

-- ---------- deals ----------
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  entry_index integer not null,
  created_at bigint not null,
  updated_at bigint not null,
  data jsonb not null default '{}'::jsonb
);
create index if not exists deals_entry_index_idx on deals (entry_index);
create index if not exists deals_updated_at_idx on deals (updated_at);
create index if not exists deals_data_gin_idx on deals using gin (data);

-- ---------- expenses ----------
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null default '',
  category text default '',
  amount numeric not null default 0,
  currency text not null default 'USD',
  date text default '',
  deal_id uuid references deals(id) on delete set null,
  created_at bigint not null
);
create index if not exists expenses_date_idx on expenses (date);
create index if not exists expenses_deal_id_idx on expenses (deal_id);

-- ---------- contact_updates ----------
-- One row per logged update against a contact (not a deal — the same
-- person can be the contact on several deals, so this is keyed by the
-- same identity contacts.js groups by: lowercased name + '|' + number).
create table if not exists contact_updates (
  id uuid primary key default gen_random_uuid(),
  contact_key text not null,
  data jsonb not null default '{}'::jsonb  -- datetime, channel, status, nextStep, nextStepDate, note, contactName
);
create index if not exists contact_updates_contact_key_idx on contact_updates (contact_key);

-- ---------- options ----------
-- Editable-dropdown values the user has typed and saved (relation,
-- requirement, services, invoiceDescriptions, channel, action,
-- nextstep, expenseCategory, fieldOfWork, nationality, ...). Built-in
-- defaults still live in SEED_OPTIONS in storage.js — this table only
-- holds what's been added beyond that.
create table if not exists options (
  key text not null,
  value text not null,
  primary key (key, value)
);

-- ---------- settings ----------
-- Small single-value settings: usdToSdg, revenueGoalUSD, invoiceCounter,
-- invoiceTemplate. One row per key, value is jsonb so it can hold a
-- number, string, or object uniformly.
create table if not exists settings (
  key text primary key,
  value jsonb not null
);
insert into settings (key, value) values ('usdToSdg', '3200') on conflict (key) do nothing;
insert into settings (key, value) values ('revenueGoalUSD', '0') on conflict (key) do nothing;
insert into settings (key, value) values ('invoiceCounter', '0') on conflict (key) do nothing;
insert into settings (key, value) values ('invoiceTemplate', '{}') on conflict (key) do nothing;

-- ---------- metric_snapshots ----------
-- One row per calendar day the app was opened, capturing a handful of
-- KPI values at that moment — the only honest way to show a real
-- week-over-week delta on the Overview dashboard (see charts.js).
create table if not exists metric_snapshots (
  date text primary key,
  metrics jsonb not null
);

-- ============================================================
-- Row Level Security
-- ------------------------------------------------------------
-- This app calls Supabase directly from the browser using the
-- public "anon"/"publishable" key, with no login system. That means
-- RLS is the ONLY thing standing between "anyone who has the URL +
-- key" and your data. The policies below allow that key full
-- read/write access, which matches what localStorage gave you before
-- (anyone with browser access could edit everything) — it does NOT
-- add a login wall. If this app is ever exposed somewhere more public
-- than your own machine/team, add Supabase Auth and tighten these to
-- check auth.uid().
-- ============================================================

alter table deals enable row level security;
alter table expenses enable row level security;
alter table contact_updates enable row level security;
alter table options enable row level security;
alter table settings enable row level security;
alter table metric_snapshots enable row level security;

drop policy if exists "deals_anon_all" on deals;
create policy "deals_anon_all" on deals for all using (true) with check (true);

drop policy if exists "expenses_anon_all" on expenses;
create policy "expenses_anon_all" on expenses for all using (true) with check (true);

drop policy if exists "contact_updates_anon_all" on contact_updates;
create policy "contact_updates_anon_all" on contact_updates for all using (true) with check (true);

drop policy if exists "options_anon_all" on options;
create policy "options_anon_all" on options for all using (true) with check (true);

drop policy if exists "settings_anon_all" on settings;
create policy "settings_anon_all" on settings for all using (true) with check (true);

drop policy if exists "metric_snapshots_anon_all" on metric_snapshots;
create policy "metric_snapshots_anon_all" on metric_snapshots for all using (true) with check (true);

-- ============================================================
-- Realtime (optional but recommended)
-- ------------------------------------------------------------
-- Lets a second open tab/device pick up changes live. storage.js
-- subscribes to `deals` changes if this is enabled; harmless if you
-- skip it. Guarded so re-running this script is always safe, even
-- if a table was already added to the publication before.
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deals') then
    alter publication supabase_realtime add table deals;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expenses') then
    alter publication supabase_realtime add table expenses;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contact_updates') then
    alter publication supabase_realtime add table contact_updates;
  end if;
end $$;

-- ============================================================
-- Maintenance & data-integrity hardening
-- ------------------------------------------------------------
-- net._http_response logs every outgoing webhook call (used by the
-- optional Google Sheets sync trigger) with nothing cleaning it up by
-- default — schedule a daily prune so it doesn't grow unbounded over
-- months. The CHECK constraints below are unrelated to RLS/access
-- control (see the RLS comment above — full anon read/write is correct
-- for this no-login single-user app); they just stop obviously-invalid
-- data from being written regardless of what wrote it.
-- ============================================================

create extension if not exists pg_cron;

-- cron.schedule() updates the existing job in place if 'cleanup-http-response-log'
-- already exists, so this is naturally safe to re-run.
select cron.schedule(
  'cleanup-http-response-log',
  '0 3 * * *',  -- daily at 03:00 UTC
  $$ delete from net._http_response where created < now() - interval '7 days' $$
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_amount_nonnegative') then
    alter table expenses add constraint expenses_amount_nonnegative check (amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_currency_valid') then
    alter table expenses add constraint expenses_currency_valid check (currency in ('USD', 'SDG'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deals_entry_index_positive') then
    alter table deals add constraint deals_entry_index_positive check (entry_index > 0);
  end if;
end $$;
