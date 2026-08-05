/* ============================================================
   storage.js
   ------------------------------------------------------------
   The ONLY file that touches localStorage. Everything else in
   the app calls these functions. Swap the internals for real
   backend (e.g. Supabase) calls later without touching any
   other file.

   Exposes (as plain globals, since these are classic scripts):
     - escapeHtml(str)
     - getDeals() / saveDeal(deal) / deleteDeal(id) / getNextEntryIndex()
     - getOptions(key) / addOption(key, value)
   ============================================================ */

const DEALS_KEY = 'deal-ledger:deals';

function optionsStorageKey(key) {
  return 'deal-ledger:opts:' + key;
}

// ---------- Shared helpers ----------
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
function readAllDeals() {
  try {
    const raw = localStorage.getItem(DEALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read deals from storage', err);
    return [];
  }
}

function writeAllDeals(deals) {
  localStorage.setItem(DEALS_KEY, JSON.stringify(deals));
}

function getDeals() {
  return readAllDeals().sort((a, b) => a.entryIndex - b.entryIndex);
}

function getNextEntryIndex() {
  const deals = readAllDeals();
  if (deals.length === 0) return 1;
  return Math.max(...deals.map(d => d.entryIndex)) + 1;
}

function saveDeal(deal) {
  const deals = readAllDeals();
  const existingIdx = deals.findIndex(d => d.id === deal.id);

  if (existingIdx >= 0) {
    deals[existingIdx] = Object.assign({}, deals[existingIdx], deal, { updatedAt: Date.now() });
  } else {
    deals.push(Object.assign({}, deal, {
      id: deal.id || crypto.randomUUID(),
      entryIndex: getNextEntryIndex(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  }

  writeAllDeals(deals);
  return deals;
}

function deleteDeal(id) {
  const deals = readAllDeals().filter(d => d.id !== id);
  writeAllDeals(deals);
  return deals;
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
// A new top-level entity (not deal-scoped like invoices/commLog) — a business
// expense can exist with no deal at all (rent, software subscriptions) or
// optionally link to one (a contractor paid specifically for that project).
const EXPENSES_KEY = 'deal-ledger:expenses';

function getExpenses() {
  let expenses;
  try {
    expenses = JSON.parse(localStorage.getItem(EXPENSES_KEY) || '[]');
  } catch (err) {
    expenses = [];
  }
  return expenses.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function saveExpense(expense) {
  const expenses = getExpenses();
  const idx = expenses.findIndex(e => e.id === expense.id);
  if (idx >= 0) {
    expenses[idx] = Object.assign({}, expenses[idx], expense);
  } else {
    expenses.push(Object.assign({}, expense, { id: expense.id || crypto.randomUUID(), createdAt: Date.now() }));
  }
  localStorage.setItem(EXPENSES_KEY, JSON.stringify(expenses));
  return expenses;
}

function deleteExpense(id) {
  const expenses = getExpenses().filter(e => e.id !== id);
  localStorage.setItem(EXPENSES_KEY, JSON.stringify(expenses));
  return expenses;
}

// ---------- Contact-level updates ----------
// A contact (see contacts.js) isn't its own stored record — it's a group
// computed live from every deal's firstContact/projectManager. But a
// contact's update history genuinely doesn't belong to any single deal
// (the same person can be the contact on several deals at once), so their
// updates get their own storage key, keyed by the same identity
// contacts.js already groups by: lowercased name + '|' + number.
const CONTACT_UPDATES_KEY = 'deal-ledger:contact-updates';

function contactKeyOf(name, number) {
  return (name || '').trim().toLowerCase() + '|' + (number || '').trim();
}

function readContactUpdatesMap() {
  try {
    return JSON.parse(localStorage.getItem(CONTACT_UPDATES_KEY) || '{}');
  } catch (err) {
    return {};
  }
}

function writeContactUpdatesMap(map) {
  localStorage.setItem(CONTACT_UPDATES_KEY, JSON.stringify(map));
}

function getContactUpdates(contactKey) {
  const map = readContactUpdatesMap();
  return (map[contactKey] || []).slice();
}

function addContactUpdate(contactKey, entry) {
  const map = readContactUpdatesMap();
  const list = (map[contactKey] || []).slice();
  list.push(Object.assign({ id: crypto.randomUUID() }, entry));
  map[contactKey] = list;
  writeContactUpdatesMap(map);
  return list;
}

function deleteContactUpdate(contactKey, entryId) {
  const map = readContactUpdatesMap();
  map[contactKey] = (map[contactKey] || []).filter(e => e.id !== entryId);
  writeContactUpdatesMap(map);
}

// Every contact update, across every contact, flattened and tagged with its
// contactKey — used by the Calendar and Overview dashboard to fold
// contact-level follow-ups in alongside deal-level ones without having to
// loop the whole map themselves.
function getAllContactUpdatesFlat() {
  const map = readContactUpdatesMap();
  const out = [];
  Object.keys(map).forEach(key => {
    (map[key] || []).forEach(entry => out.push(Object.assign({ contactKey: key }, entry)));
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
  let custom = [];
  try {
    custom = JSON.parse(localStorage.getItem(optionsStorageKey(key)) || '[]');
  } catch (err) {
    custom = [];
  }
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

  let custom = [];
  try {
    custom = JSON.parse(localStorage.getItem(optionsStorageKey(key)) || '[]');
  } catch (err) {
    custom = [];
  }
  if (custom.some(c => c.toLowerCase() === value.toLowerCase())) return;

  custom.push(value);
  localStorage.setItem(optionsStorageKey(key), JSON.stringify(custom));
}

// ---------- Dual currency (USD / SDG) ----------
// One global exchange rate, editable in Settings. Deals store only the
// currency + amount as entered (original*); every displayed figure is
// converted live from the CURRENT rate, so changing the rate updates every
// display instantly without altering what was originally entered.
const SETTINGS_KEY = 'deal-ledger:settings';
const DEFAULT_EXCHANGE_RATE = 3200; // 1 USD = this many SDG, until the user sets their own

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function getExchangeRate() {
  const rate = Number(getSettings().usdToSdg);
  return rate > 0 ? rate : DEFAULT_EXCHANGE_RATE;
}

function setExchangeRate(rate) {
  rate = Number(rate);
  if (!(rate > 0)) return;
  const settings = getSettings();
  settings.usdToSdg = rate;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------- Revenue goal (used by the Overview dashboard's goal tracker) ----------
function getRevenueGoal() {
  const goal = Number(getSettings().revenueGoalUSD);
  return goal > 0 ? goal : 0;
}

function setRevenueGoal(amountUSD) {
  amountUSD = Number(amountUSD);
  const settings = getSettings();
  settings.revenueGoalUSD = amountUSD > 0 ? amountUSD : 0;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------- Metric snapshots (powers real week-over-week deltas on Overview) ----------
// One entry per calendar day the app was opened, capturing a handful of KPI
// values at that moment. This is the ONLY way to show an honest "up/down
// since last week" — without stored history there's nothing real to compare
// against, so we take a snapshot once per day (see recordTodaysSnapshotIfNeeded
// in charts.js) instead of ever fabricating a trend.
const METRIC_SNAPSHOTS_KEY = 'deal-ledger:metric-snapshots';
const MAX_SNAPSHOTS = 120; // ~4 months of daily snapshots is plenty for week/month deltas

function getMetricSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(METRIC_SNAPSHOTS_KEY) || '[]');
  } catch (err) {
    return [];
  }
}

function saveMetricSnapshot(dateKey, metrics) {
  let snapshots = getMetricSnapshots().filter(s => s.date !== dateKey);
  snapshots.push({ date: dateKey, metrics });
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  if (snapshots.length > MAX_SNAPSHOTS) snapshots = snapshots.slice(-MAX_SNAPSHOTS);
  localStorage.setItem(METRIC_SNAPSHOTS_KEY, JSON.stringify(snapshots));
}

// Finds the snapshot closest to (but not after) `daysAgo` days ago — e.g.
// getSnapshotNDaysAgo(7) for a week-over-week delta. Returns null if there's
// no snapshot old enough yet (e.g. the app was only started using this week).
function getSnapshotNDaysAgo(daysAgo) {
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  const targetKey = target.toISOString().slice(0, 10);
  const snapshots = getMetricSnapshots();
  let best = null;
  snapshots.forEach(s => {
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
function getNextInvoiceNumber() {
  const key = 'deal-ledger:invoice-counter';
  let n = Number(localStorage.getItem(key)) || 0;
  n += 1;
  localStorage.setItem(key, String(n));
  return 'INV-' + String(n).padStart(4, '0');
}

// ---------- Invoice template (upload-once branding used on every invoice) ----------
const INVOICE_TEMPLATE_KEY = 'deal-ledger:invoice-template';

function getInvoiceTemplate() {
  try {
    return JSON.parse(localStorage.getItem(INVOICE_TEMPLATE_KEY) || '{}');
  } catch (err) {
    return {};
  }
}

function setInvoiceTemplate(template) {
  localStorage.setItem(INVOICE_TEMPLATE_KEY, JSON.stringify(template || {}));
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
