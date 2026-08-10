/* ============================================================
   storage.js
   ------------------------------------------------------------
   The ONLY file that touches the database. Everything else in
   the app still calls plain, SYNCHRONOUS functions like
   getDeals() / saveDeal() / getOptions() exactly as before — this
   file hides Supabase (Postgres) behind an in-memory cache so no
   other file had to become async-aware.

   How it works:
     1. On startup, app.js awaits initStorage() ONCE. That pulls
        every deal/expense/contact-update/option/setting/snapshot
        from Supabase into the caches below and subscribes to
        Realtime changes on the shared tables.
     2. After that, getDeals() etc. just read the cache — instant,
        synchronous, same as localStorage.getItem() was.
     3. saveDeal() / deleteDeal() / addOption() / setExchangeRate()
        etc. update the cache immediately (so the UI feels instant)
        AND fire a background write to Supabase. If that background
        write fails (offline, bad keys), it's logged to the console
        and surfaced via a toast if the app has finished loading —
        the cache itself is NOT rolled back, so a flaky connection
        doesn't yank data out from under the person mid-edit.

   SETUP: fill in SUPABASE_URL and SUPABASE_ANON_KEY below with the
   values from your Supabase project's Settings → API page, and run
   supabase_schema.sql once in the SQL Editor. The anon/publishable
   key is safe to ship in client-side code — see the schema file's
   comment on Row Level Security for what that key can and can't do.
   NEVER put the secret key or database password here — this file
   ships to every browser that loads the page.

   Exposes (same names/signatures as before, plus initStorage()):
     - initStorage() -> Promise, call once before anything else
     - escapeHtml(str)
     - getDeals() / saveDeal(deal) / deleteDeal(id) / getNextEntryIndex()
     - getExpenses() / saveExpense(expense) / deleteExpense(id)
     - contactKeyOf(name, number) / getContactUpdates(key) /
       addContactUpdate(key, entry) / deleteContactUpdate(key, id) /
       getAllContactUpdatesFlat()
     - getOptions(key) / addOption(key, value)
     - getExchangeRate() / setExchangeRate(rate)
     - getRevenueGoal() / setRevenueGoal(amountUSD)
     - getMetricSnapshots() / saveMetricSnapshot(dateKey, metrics) /
       getSnapshotNDaysAgo(daysAgo)
     - getInvoiceTemplate() / setInvoiceTemplate(template)
     - getNextInvoiceNumber()
   ============================================================ */

// ---------- Supabase config — fill these in ----------
const SUPABASE_URL = 'https://tqjnahwfvhiictbmywog.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bP8qpXFzl2oJDE_CiAJ6Xw_ibZahNZ8';

let supabaseClient = null;
let dbReady = false;
let dbInitError = null;

// ---------- In-memory cache (what every other file actually reads) ----------
let _dealsCache = [];               // array of deal objects, same shape as before
let _expensesCache = [];            // array of expense objects, same shape as before
let _contactUpdatesCache = {};      // { contactKey: [entry, entry, ...] }
let _optionsCache = {};             // { relation: ['...','...'], channel: [...], ... }
let _metricSnapshotsCache = [];     // [{ date, metrics }, ...]
let _settingsCache = {              // mirrors the old localStorage-backed settings
  usdToSdg: null,                   // null until loaded; getExchangeRate() falls back to default
  revenueGoalUSD: 0,
  invoiceCounter: 0,
  invoiceTemplate: {},
};

const MAX_SNAPSHOTS = 120; // ~4 months of daily snapshots is plenty for week/month deltas

// Fire-and-forget background persistence. Never throws into the caller —
// storage functions already updated the cache and returned by the time
// this runs, so a failure here just means "not saved to the cloud yet."
//
// `run` is a zero-argument function that PERFORMS the Supabase call (not
// an already-started promise) so it can be safely re-invoked later if it
// fails — a promise can only ever settle once, but a function can be
// called again. See the retry queue below.
function _bgPersist(run, what) {
  Promise.resolve().then(run).then(({ error } = {}) => {
    if (error) _queueRetry(run, what, error);
  }).catch(err => _queueRetry(run, what, err));
}

// ---------- Retry queue for failed background writes ----------
// A brief connection blip used to mean that edit just silently never made
// it to the cloud — the cache had it, but Supabase never did, and nothing
// tried again. Failed writes now queue up here and retry automatically:
// periodically in the background, and immediately when the browser fires
// its 'online' event (e.g. wifi reconnecting, laptop waking up).
let _retryQueue = [];        // [{ run, what, attempts }]
let _retryFlushTimer = null;
const MAX_RETRY_ATTEMPTS = 8;
const RETRY_BASE_DELAY_MS = 15000;
const RETRY_MAX_DELAY_MS = 120000;

function _queueRetry(run, what, err) {
  console.error('Supabase write failed (' + what + '):', err);
  _retryQueue.push({ run, what, attempts: 0 });
  if (typeof showToast === 'function' && dbReady) {
    showToast('Sync issue — will keep retrying in the background.');
  }
  _scheduleRetryFlush(RETRY_BASE_DELAY_MS);
}

function _scheduleRetryFlush(delayMs) {
  if (_retryFlushTimer) return;
  _retryFlushTimer = setTimeout(() => {
    _retryFlushTimer = null;
    _flushRetryQueue();
  }, delayMs);
}

function _flushRetryQueue() {
  if (_retryQueue.length === 0) return;
  const pending = _retryQueue;
  const hadItems = pending.length;
  _retryQueue = [];

  let stillFailing = 0;
  let settled = 0;

  pending.forEach(item => {
    item.attempts += 1;
    Promise.resolve().then(item.run).then(({ error } = {}) => {
      settled++;
      if (error) throw error;
      if (settled === hadItems && stillFailing === 0 && typeof showToast === 'function' && dbReady) {
        showToast('Reconnected — pending changes synced.');
      }
    }).catch(err => {
      settled++;
      if (item.attempts < MAX_RETRY_ATTEMPTS) {
        stillFailing++;
        _retryQueue.push(item);
      } else {
        console.error('Giving up on "' + item.what + '" after ' + item.attempts + ' attempts:', err);
        if (typeof showToast === 'function') {
          showToast('Could not sync "' + item.what + '" after several tries — check your connection.');
        }
      }
    });
  });

  if (_retryQueue.length > 0 || hadItems > 0) {
    // Simple exponential backoff, capped, so a long outage doesn't hammer
    // Supabase every 15s indefinitely.
    const nextDelay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, Math.min(...pending.map(i => i.attempts), 5)), RETRY_MAX_DELAY_MS);
    setTimeout(() => { if (_retryQueue.length > 0) _scheduleRetryFlush(nextDelay); }, 500);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => _flushRetryQueue());
}

// ---------- Init — call once from app.js before rendering anything ----------
async function initStorage() {
  if (typeof window.supabase === 'undefined') {
    dbInitError = 'The Supabase library did not load — check the <script> tag / your internet connection.';
    console.error(dbInitError);
    return;
  }
  if (SUPABASE_URL.includes('YOUR-PROJECT-REF') || SUPABASE_ANON_KEY.includes('YOUR-ANON-PUBLIC-KEY')) {
    dbInitError = 'Supabase isn\'t configured yet — set SUPABASE_URL and SUPABASE_ANON_KEY at the top of storage.js.';
    console.error(dbInitError);
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    const [dealsRes, expensesRes, contactUpdatesRes, optionsRes, settingsRes, snapshotsRes] = await Promise.all([
      supabaseClient.from('deals').select('*'),
      supabaseClient.from('expenses').select('*'),
      supabaseClient.from('contact_updates').select('*'),
      supabaseClient.from('options').select('*'),
      supabaseClient.from('settings').select('*'),
      supabaseClient.from('metric_snapshots').select('*'),
    ]);

    [dealsRes, expensesRes, contactUpdatesRes, optionsRes, settingsRes, snapshotsRes].forEach(res => {
      if (res.error) throw res.error;
    });

    _dealsCache = (dealsRes.data || []).map(_rowToDeal);
    _expensesCache = (expensesRes.data || []).map(_rowToExpense);

    _contactUpdatesCache = {};
    (contactUpdatesRes.data || []).forEach(row => {
      const key = row.contact_key;
      if (!_contactUpdatesCache[key]) _contactUpdatesCache[key] = [];
      _contactUpdatesCache[key].push(Object.assign({ id: row.id }, row.data));
    });

    _optionsCache = {};
    (optionsRes.data || []).forEach(row => {
      if (!_optionsCache[row.key]) _optionsCache[row.key] = [];
      _optionsCache[row.key].push(row.value);
    });

    (settingsRes.data || []).forEach(row => {
      _settingsCache[row.key] = row.value;
    });

    _metricSnapshotsCache = (snapshotsRes.data || [])
      .map(row => ({ date: row.date, metrics: row.metrics }))
      .sort((a, b) => a.date.localeCompare(b.date));

    _subscribeToRealtime();
    dbReady = true;
  } catch (err) {
    dbInitError = (err && err.message) ? err.message : 'Could not reach the database.';
    console.error('initStorage failed:', err);
  }
}

// Live sync: if another tab/device changes deals/expenses/contact updates,
// refresh that slice of the cache and re-render. Simple "refetch the whole
// table" on any change — this app's own data is small enough that it's
// cheap, and it avoids subtle merge bugs from patching individual rows.
function _subscribeToRealtime() {
  if (!supabaseClient) return;

  supabaseClient
    .channel('deals-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
      supabaseClient.from('deals').select('*').then(({ data, error }) => {
        if (error) { console.error('Realtime refresh failed (deals):', error); return; }
        _dealsCache = (data || []).map(_rowToDeal);
        if (typeof renderEverything === 'function') renderEverything();
      });
    })
    .subscribe();

  supabaseClient
    .channel('expenses-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => {
      supabaseClient.from('expenses').select('*').then(({ data, error }) => {
        if (error) { console.error('Realtime refresh failed (expenses):', error); return; }
        _expensesCache = (data || []).map(_rowToExpense);
        if (typeof renderFinancial === 'function') renderFinancial();
      });
    })
    .subscribe();

  supabaseClient
    .channel('contact-updates-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_updates' }, () => {
      supabaseClient.from('contact_updates').select('*').then(({ data, error }) => {
        if (error) { console.error('Realtime refresh failed (contact_updates):', error); return; }
        _contactUpdatesCache = {};
        (data || []).forEach(row => {
          const key = row.contact_key;
          if (!_contactUpdatesCache[key]) _contactUpdatesCache[key] = [];
          _contactUpdatesCache[key].push(Object.assign({ id: row.id }, row.data));
        });
        if (typeof renderEverything === 'function') renderEverything();
      });
    })
    .subscribe();
}

// ---------- Row <-> object shape converters ----------
function _rowToDeal(row) {
  return Object.assign({}, row.data, {
    id: row.id,
    entryIndex: row.entry_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function _dealToRow(deal) {
  const data = Object.assign({}, deal);
  delete data.id;
  delete data.entryIndex;
  delete data.createdAt;
  delete data.updatedAt;
  return {
    id: deal.id,
    entry_index: deal.entryIndex,
    created_at: deal.createdAt,
    updated_at: deal.updatedAt,
    data,
  };
}

function _rowToExpense(row) {
  return {
    id: row.id,
    description: row.description,
    category: row.category,
    amount: row.amount,
    currency: row.currency,
    date: row.date,
    dealId: row.deal_id,
    createdAt: row.created_at,
  };
}

function _expenseToRow(expense) {
  return {
    id: expense.id,
    description: expense.description || '',
    category: expense.category || '',
    amount: Number(expense.amount) || 0,
    currency: expense.currency || 'USD',
    date: expense.date || '',
    deal_id: expense.dealId || null,
    created_at: expense.createdAt,
  };
}

// ---------- Shared helpers (unchanged — pure logic, no storage) ----------
// Relative "time since" label, e.g. "3h ago", "5d ago". Used for the
// deals table's "Last activity" column and the detail modal.
function timeAgo(ts) {
  if (!ts) return null;
  const diffMs = Date.now() - Number(ts);
  if (diffMs < 0) return 'just now';

  const minute = 60 * 1000, hour = 60 * minute, day = 24 * hour,
    month = 30 * day, year = 365 * day;

  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return Math.floor(diffMs / minute) + 'm ago';
  if (diffMs < day) return Math.floor(diffMs / hour) + 'h ago';
  if (diffMs < month) return Math.floor(diffMs / day) + 'd ago';
  if (diffMs < year) return Math.floor(diffMs / month) + 'mo ago';
  return Math.floor(diffMs / year) + 'y ago';
}

// Most recent thing that happened on a deal: latest comm-log entry if any,
// otherwise whenever the deal record itself was last saved.
function lastActivityTimestamp(deal) {
  let latest = deal.updatedAt || deal.createdAt || null;
  (deal.commLog || []).forEach(entry => {
    if (!entry.datetime) return;
    const t = new Date(entry.datetime).getTime();
    if (!isNaN(t) && (!latest || t > latest)) latest = t;
  });
  return latest;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// ---------- Deals ----------
function getDeals() {
  return _dealsCache.slice().sort((a, b) => a.entryIndex - b.entryIndex);
}

function getNextEntryIndex() {
  if (_dealsCache.length === 0) return 1;
  return Math.max(..._dealsCache.map(d => d.entryIndex)) + 1;
}

function saveDeal(deal) {
  const existingIdx = _dealsCache.findIndex(d => d.id === deal.id);
  let saved;

  if (existingIdx >= 0) {
    saved = Object.assign({}, _dealsCache[existingIdx], deal, { updatedAt: Date.now() });
    _dealsCache[existingIdx] = saved;
  } else {
    saved = Object.assign({}, deal, {
      id: deal.id || crypto.randomUUID(),
      entryIndex: getNextEntryIndex(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    _dealsCache.push(saved);
  }

  if (supabaseClient) {
    _bgPersist(() => supabaseClient.from('deals').upsert(_dealToRow(saved), { onConflict: 'id' }), 'saveDeal');
  }

  return _dealsCache;
}

function deleteDeal(id) {
  _dealsCache = _dealsCache.filter(d => d.id !== id);
  if (supabaseClient) {
    _bgPersist(() => supabaseClient.from('deals').delete().eq('id', id), 'deleteDeal');
  }
  return _dealsCache;
}

// Distinct entity names seen across deals — powers the entity-name
// autocomplete datalist and duplicate-prevention autofill.
function getEntityNames() {
  const seen = new Set();
  const names = [];
  getDeals().forEach(d => {
    if (d.entityName && !seen.has(d.entityName.toLowerCase())) {
      seen.add(d.entityName.toLowerCase());
      names.push(d.entityName);
    }
  });
  return names;
}

// ---------- Expenses ----------
// A top-level entity (not deal-scoped like invoices/commLog) — a business
// expense can exist with no deal at all (rent, software subscriptions) or
// optionally link to one (a contractor paid specifically for that project).
function getExpenses() {
  return _expensesCache.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function saveExpense(expense) {
  const idx = _expensesCache.findIndex(e => e.id === expense.id);
  let saved;
  if (idx >= 0) {
    saved = Object.assign({}, _expensesCache[idx], expense);
    _expensesCache[idx] = saved;
  } else {
    saved = Object.assign({}, expense, { id: expense.id || crypto.randomUUID(), createdAt: Date.now() });
    _expensesCache.push(saved);
  }
  if (supabaseClient) {
    _bgPersist(() => supabaseClient.from('expenses').upsert(_expenseToRow(saved), { onConflict: 'id' }), 'saveExpense');
  }
  return _expensesCache;
}

function deleteExpense(id) {
  _expensesCache = _expensesCache.filter(e => e.id !== id);
  if (supabaseClient) {
    _bgPersist(() => supabaseClient.from('expenses').delete().eq('id', id), 'deleteExpense');
  }
  return _expensesCache;
}

// ---------- Contact-level updates ----------
// A contact (see contacts.js) isn't its own stored record — it's a group
// computed live from every deal's firstContact/projectManager. But a
// contact's update history genuinely doesn't belong to any single deal
// (the same person can be the contact on several deals at once), so their
// updates get their own table, keyed by the same identity contacts.js
// already groups by: lowercased name + '|' + number.
function contactKeyOf(name, number) {
  return (name || '').trim().toLowerCase() + '|' + (number || '').trim();
}

function getContactUpdates(contactKey) {
  return (_contactUpdatesCache[contactKey] || []).slice();
}

function addContactUpdate(contactKey, entry) {
  const id = crypto.randomUUID();
  const full = Object.assign({ id }, entry);
  if (!_contactUpdatesCache[contactKey]) _contactUpdatesCache[contactKey] = [];
  _contactUpdatesCache[contactKey].push(full);

  if (supabaseClient) {
    _bgPersist(
      () => supabaseClient.from('contact_updates').upsert({ id, contact_key: contactKey, data: entry }, { onConflict: 'id' }),
      'addContactUpdate'
    );
  }
  return _contactUpdatesCache[contactKey];
}

function deleteContactUpdate(contactKey, entryId) {
  _contactUpdatesCache[contactKey] = (_contactUpdatesCache[contactKey] || []).filter(e => e.id !== entryId);
  if (supabaseClient) {
    _bgPersist(() => supabaseClient.from('contact_updates').delete().eq('id', entryId), 'deleteContactUpdate');
  }
}

// Every contact update, across every contact, flattened and tagged with its
// contactKey — used by the Calendar and Overview dashboard to fold
// contact-level follow-ups in alongside deal-level ones without having to
// loop the whole map themselves.
function getAllContactUpdatesFlat() {
  const out = [];
  Object.keys(_contactUpdatesCache).forEach(key => {
    (_contactUpdatesCache[key] || []).forEach(entry => out.push(Object.assign({ contactKey: key }, entry)));
  });
  return out;
}

// Most recently updated deal for a given entity name (case-insensitive
// exact match). Used to auto-fill entity details when someone starts a
// new deal for a company we've already dealt with, instead of re-asking.
function findLatestDealForEntity(name) {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  const matches = getDeals().filter(d => (d.entityName || '').trim().toLowerCase() === key);
  if (!matches.length) return null;
  return matches.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
}

// ---------- Editable dropdown option lists ----------
// Built-in defaults. A field's live list = these + whatever the user has
// typed and saved before (merged, de-duplicated, case-insensitive).
const SEED_OPTIONS = {
  relation: [
    'Decision maker', 'Point of contact', 'Introduced by mutual contact',
    'Long-time partner', 'Referred us business before', 'New contact',
  ],
  requirement: [
    'Website', 'System', 'Mobile App', 'ERP', 'Hosting', 'Maintenance', 'Consultation', 'Other',
  ],
  services: [
    'Web Development', 'Mobile Development', 'Hosting', 'SEO', 'Branding',
    'Consultation', 'Support', 'Training', 'Maintenance',
  ],
  invoiceDescriptions: [
    'Downpayment', 'Second Payment', 'Third Payment', 'Final Payment', 'Full Payment',
    'Website', 'System', 'Mobile App', 'ERP', 'Hosting', 'Maintenance', 'Consultation', 'Support',
  ],
  channel: [
    'Call', 'Email', 'WhatsApp', 'Meeting', 'Site visit', 'Letter',
  ],
  action: [
    'Sent proposal', 'Negotiated terms', 'Signed contract',
    'Requested information', 'Follow-up call', 'No answer', 'Price discussion',
  ],
  nextstep: [
    'Awaiting response', 'Schedule meeting', 'Send contract',
    'Follow up next week', 'Close deal', 'On hold', 'Needs internal review',
  ],
  expenseCategory: [
    'Contractor / Freelancer', 'Software & Tools', 'Advertising & Marketing',
    'Hosting & Infrastructure', 'Office & Admin', 'Travel', 'Bank & Payment Fees', 'Other',
  ],
  // These start empty on purpose — pure learn-as-you-go from what gets typed,
  // rather than guessing at a business's specific fields/locations/etc.
  fieldOfWork: [],
  nationality: [],
  currentLocation: [],
  reasonEnded: [],
  specialInstructions: [],
  personName: [],
  expenseDescription: [],
  documentName: [],
};

function getOptions(key) {
  const seed = SEED_OPTIONS[key] || [];
  const custom = _optionsCache[key] || [];
  const seen = new Set(seed.map(s => s.toLowerCase()));
  const merged = seed.slice();
  custom.forEach(c => {
    if (c && !seen.has(c.toLowerCase())) {
      merged.push(c);
      seen.add(c.toLowerCase());
    }
  });
  return merged;
}

function addOption(key, value) {
  value = (value || '').trim();
  if (!value) return;

  const seed = SEED_OPTIONS[key] || [];
  if (seed.some(s => s.toLowerCase() === value.toLowerCase())) return;

  const custom = _optionsCache[key] || [];
  if (custom.some(c => c.toLowerCase() === value.toLowerCase())) return;

  _optionsCache[key] = custom.concat([value]);

  if (supabaseClient) {
    _bgPersist(
      () => supabaseClient.from('options').upsert({ key, value }, { onConflict: 'key,value', ignoreDuplicates: true }),
      'addOption'
    );
  }
}

// ---------- Dual currency (USD / SDG) ----------
// One shared exchange rate, editable in Settings, synced through the
// `settings` table so it's the same for everyone hitting this database.
// Deals still store only the currency + amount as entered; every displayed
// figure is converted live from the CURRENT rate.
const DEFAULT_EXCHANGE_RATE = 3200; // 1 USD = this many SDG, until someone sets their own

function getExchangeRate() {
  const rate = Number(_settingsCache.usdToSdg);
  return rate > 0 ? rate : DEFAULT_EXCHANGE_RATE;
}

function setExchangeRate(rate) {
  rate = Number(rate);
  if (!(rate > 0)) return;
  _settingsCache.usdToSdg = rate;
  if (supabaseClient) {
    _bgPersist(() => supabaseClient.from('settings').upsert({ key: 'usdToSdg', value: rate }, { onConflict: 'key' }), 'setExchangeRate');
  }
}

// ---------- Revenue goal (used by the Overview dashboard's goal tracker) ----------
function getRevenueGoal() {
  const goal = Number(_settingsCache.revenueGoalUSD);
  return goal > 0 ? goal : 0;
}

function setRevenueGoal(amountUSD) {
  amountUSD = Number(amountUSD);
  _settingsCache.revenueGoalUSD = amountUSD > 0 ? amountUSD : 0;
  if (supabaseClient) {
    _bgPersist(
      () => supabaseClient.from('settings').upsert({ key: 'revenueGoalUSD', value: _settingsCache.revenueGoalUSD }, { onConflict: 'key' }),
      'setRevenueGoal'
    );
  }
}

// ---------- Metric snapshots (powers real week-over-week deltas on Overview) ----------
// One entry per calendar day the app was opened, capturing a handful of KPI
// values at that moment. This is the ONLY way to show an honest "up/down
// since last week" — without stored history there's nothing real to compare
// against, so we take a snapshot once per day (see recordTodaysSnapshotIfNeeded
// in charts.js) instead of ever fabricating a trend.
function getMetricSnapshots() {
  return _metricSnapshotsCache.slice();
}

function saveMetricSnapshot(dateKey, metrics) {
  let snapshots = _metricSnapshotsCache.filter(s => s.date !== dateKey);
  snapshots.push({ date: dateKey, metrics });
  snapshots.sort((a, b) => a.date.localeCompare(b.date));

  let trimmedOutDates = [];
  if (snapshots.length > MAX_SNAPSHOTS) {
    trimmedOutDates = snapshots.slice(0, snapshots.length - MAX_SNAPSHOTS).map(s => s.date);
    snapshots = snapshots.slice(-MAX_SNAPSHOTS);
  }
  _metricSnapshotsCache = snapshots;

  if (supabaseClient) {
    _bgPersist(() => supabaseClient.from('metric_snapshots').upsert({ date: dateKey, metrics }, { onConflict: 'date' }), 'saveMetricSnapshot');
    if (trimmedOutDates.length) {
      _bgPersist(() => supabaseClient.from('metric_snapshots').delete().in('date', trimmedOutDates), 'trimMetricSnapshots');
    }
  }
}

// Finds the snapshot closest to (but not after) `daysAgo` days ago — e.g.
// getSnapshotNDaysAgo(7) for a week-over-week delta. Returns null if there's
// no snapshot old enough yet (e.g. the app was only started using this week).
function getSnapshotNDaysAgo(daysAgo) {
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  const targetKey = target.toISOString().slice(0, 10);
  let best = null;
  _metricSnapshotsCache.forEach(s => {
    if (s.date <= targetKey && (!best || s.date > best.date)) best = s;
  });
  return best;
}

function toUSD(amount, currency) {
  amount = Number(amount) || 0;
  return currency === 'SDG' ? amount / getExchangeRate() : amount;
}

function toSDG(amount, currency) {
  amount = Number(amount) || 0;
  return currency === 'USD' ? amount * getExchangeRate() : amount;
}

// Converts a deal's value into whatever currency is requested — used when an
// invoice's currency doesn't match the deal's own currency.
function valueInCurrency(amount, fromCurrency, toCurrency) {
  const usd = toUSD(amount, fromCurrency);
  return toCurrency === 'SDG' ? toSDG(usd, 'USD') : usd;
}

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const sdgFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function formatUSD(amount) {
  return usdFormatter.format(Number(amount) || 0);
}

// Sequential, unique across the whole system — "INV-0001", "INV-0002", ...
// Only call this when actually starting a NEW invoice, not on every render.
// Note: incrementing this in the browser and syncing in the background
// means two people creating an invoice in the same instant, on two
// different devices, could theoretically collide on a number. Rare for a
// small business's own usage; if that ever matters, replace this with a
// Postgres sequence called via an RPC function instead.
function getNextInvoiceNumber() {
  const n = (Number(_settingsCache.invoiceCounter) || 0) + 1;
  _settingsCache.invoiceCounter = n;
  if (supabaseClient) {
    _bgPersist(() => supabaseClient.from('settings').upsert({ key: 'invoiceCounter', value: n }, { onConflict: 'key' }), 'getNextInvoiceNumber');
  }
  return 'INV-' + String(n).padStart(4, '0');
}

// ---------- Invoice template (upload-once branding used on every invoice) ----------
function getInvoiceTemplate() {
  return _settingsCache.invoiceTemplate || {};
}

function setInvoiceTemplate(template) {
  _settingsCache.invoiceTemplate = template || {};
  if (supabaseClient) {
    _bgPersist(
      () => supabaseClient.from('settings').upsert({ key: 'invoiceTemplate', value: template || {} }, { onConflict: 'key' }),
      'setInvoiceTemplate'
    );
  }
}

// ---------- Full backup export ----------
// A self-serve "download everything" button — independent of Supabase's own
// backups, and cheap insurance against an accidental delete or a bad edit.
// Pulls straight from the in-memory caches (already loaded by initStorage()),
// so it works offline too as long as the app has finished its initial load.
function exportAllDataAsJson() {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    deals: _dealsCache,
    expenses: _expensesCache,
    contactUpdates: _contactUpdatesCache,
    options: _optionsCache,
    settings: _settingsCache,
    metricSnapshots: _metricSnapshotsCache,
  }, null, 2);
}

function downloadFullBackup() {
  const json = exportAllDataAsJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = 'deal-ledger-backup-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Returns an HTML string: the amount in its original currency (bold),
// with the live-converted equivalent in the other currency alongside it.
function formatDualCurrency(amount, currency) {
  amount = Number(amount) || 0;
  if (currency === 'SDG') {
    const usd = toUSD(amount, 'SDG');
    return sdgFormatter.format(amount) + ' SDG <span class="fx-secondary">(' + usdFormatter.format(usd) + ')</span>';
  }
  const sdg = toSDG(amount, 'USD');
  return usdFormatter.format(amount) + ' <span class="fx-secondary">(' + sdgFormatter.format(sdg) + ' SDG)</span>';
}
