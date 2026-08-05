# Deal Ledger — project map

Plain HTML/CSS/JS. No build step, no framework. Open `index.html` directly —
every script is a classic `<script src="...">` (not `type="module"`), so it
works straight off disk (`file://`) with no local server needed.

## Why this file matters

Every file below is small on purpose (mostly under 300 lines, most under
150) and owns exactly one screen or concern. **When you're about to make a
change, find the one or two files in the table below and open only those —
don't read the whole project.** That's the entire point of this structure:
a typical edit ("change what the Overview charts show," "add a field to the
wizard," "restyle the stage badges") should only ever need one file read
and one file write.

If a task genuinely spans many files (a new deal field usually touches the
wizard, the detail view, and possibly the table), that's still cheaper than
it sounds — each file is short enough that reading three of them costs less
than reading the old 728-line `deals.js` once.

## How to find things fast

### JavaScript — one screen/concern per file

| You want to change...                                                   | Open this file          |
|---------------------------------------------------------------------------|--------------------------|
| How deals are saved/loaded, the data shape, currency conversion          | `js/storage.js` |
| Editable dropdown option lists (relation, channel, action, next step, services) | `js/storage.js` → `SEED_OPTIONS`, `getOptions()`, `addOption()` |
| Populating `<datalist>` elements for those dropdowns                     | `js/dropdowns.js` |
| Small helpers shared by the table/wizard/detail views (relationship dot, overdue check, delete confirmation) | `js/deals-shared.js` |
| **Deals table**: search, stage filter chips, sortable columns, row rendering, row click actions | `js/deals-table.js` |
| **New/edit deal wizard**: the 4 steps, comm-log editor inside it, entity autofill, save | `js/deals-wizard.js` |
| **Deal detail popup**: the read-only view opened by clicking a row       | `js/deals-detail.js` |
| Quick-add updates (status + note, from a table row or the detail view) and the Quick Update popup | `js/updates.js` |
| Invoice creation, the Invoices list in the detail view, and the print-ready client-facing invoice | `js/invoices.js` |
| Deal document attachments (small files or links) in the detail view | `js/documents.js` |
| The **Financial** tab — every invoice across every deal, expenses, income vs. expense chart | `js/financial.js` |
| The "Today" tab (daily briefing: today's items + next 7 days) | `js/today.js` |
| The "Needs attention" dashboard (overdue / closing soon / stalled / never contacted / follow-ups due) | `js/attention.js` |
| The Calendar tab (month grid built from every deal's + contact's updates, including follow-up dates) | `js/calendar.js` |
| The **Referrals** tab                                                    | `js/referrals.js` |
| The **Contacts** tab, including each contact's own update log            | `js/contacts.js` |
| The **Entities** tab                                                     | `js/entities.js` |
| The single search bar under the header (searches everything at once)    | `js/globalsearch.js` |
| The Overview dashboard — KPI stats, rule-based suggestions, and every chart | `js/charts.js` |
| Currency settings (USD ⇄ SDG rate), theme toggle, tab switching, app startup | `js/app.js` |

Load order matters and is set in `index.html`'s script tags at the bottom —
`storage.js` first, `app.js` last. Files reference each other's functions
freely (e.g. `deals-table.js` calls `openWizard()` from `deals-wizard.js`)
because classic scripts share one global scope; this is safe specifically
because every cross-file call happens inside an event handler (a click, a
form submit), which only runs after every script has finished loading —
never at the top level of a file. If you add a new top-level (not inside a
function) line that calls another file's function, put that file **after**
the one it depends on.

### CSS — split by what you're styling, not by page

| You want to change...                                                    | Open this file |
|----------------------------------------------------------------------------|------------------|
| Colors, fonts, spacing scale — including dark mode overrides              | `css/tokens.css` |
| Header, totals, stage meter, view tabs, global search bar, per-tab toolbars | `css/layout.css` |
| The shared table look (used by Deals/Referrals/Contacts/Entities), badges & chips, empty states | `css/table.css` |
| Attention dashboard cards, Calendar month grid                            | `css/dashboards.css` |
| The deal wizard, detail popup, delete/settings/quick-update/day-updates modals | `css/modals.css` |
| Invoice editor, invoice list, and the printable invoice document (incl. `@media print`) | `css/invoices.css` |
| Overview chart cards, shared animations/responsive breakpoints            | `css/charts-motion.css` |

Every file has a one-line purpose comment at the top — `grep -l "class-name"
css/*.css` is faster than opening each one if you're not sure which file a
given class lives in.

### HTML

`index.html` is one file (730-ish lines) — **this is the one file that
can't be split**. Loading an external HTML fragment via `fetch()` is blocked
by the browser when the page is opened as `file://` (the same restriction
that originally broke ES modules in this project), so there's no way to
`<include>` partial templates without requiring a local server — which
would break "just double-click it to run." The practical mitigation: every
section has an HTML comment banner (`<!-- ============ DEALS ============
-->`, `<!-- ============ CALENDAR ============ -->`, etc.) — `grep -n
"<!-- ====" index.html` lists every section and its line number, so you can
`view` just the relevant range or give `str_replace` a unique anchor instead
of reading the whole file.

## Data model

One localStorage key holds every deal: `deal-ledger:deals` → array of:

```
{
  id, entryIndex, createdAt, updatedAt,
  entityName, entityType, fieldOfWork, requirement, scale, firstTime,
  nationality, currentLocation,
  relationshipStatus, wouldWorkAgain, reasonEnded, specialInstructions, relationshipNotes,
  firstContact:   { name, number, email, relation },
  projectManager: { name, number, email, relation },
  referral:       { name, number, email, relation, firstTime, paidBefore },
  value, currency,   // currency: 'USD' or 'SDG' — the amount as originally entered
  stage, workStatus, closeDate,
  services: [ 'Hosting', 'SEO', ... ],
  paymentBreakdown: [ { id, label, percent } ],   // e.g. Downpayment 30%, Second Payment 40%, Final 30%
  commLog: [ { id, datetime, channel, action, nextStep, nextStepDate, note, status } ],
  invoices: [ { id, number, date, dueDate, currency, items: [{id, description, percent, amount}], notes, status, createdAt, sourceBreakdownId } ],
  notes
}
```

Every field on a `commLog` entry is optional, including `datetime` itself —
an entry with nothing but a `nextStepDate` and `note` is valid. `channel`
doubles as "type of update" (Call/Email/WhatsApp/etc — see `SEED_OPTIONS` in
`js/storage.js`). `nextStepDate` is a separate, optional date from
`datetime`: `datetime` is when the update happened, `nextStepDate` is when
the logged next step is due. `followUpState(entry)` in `js/updates.js`
classifies a `nextStepDate` as `'overdue'` / `'soon'` (within 7 days) /
`'later'` / `null` (no date, or `status` is `'done'`/`'canceled'`) — this
one function drives the deals-table notification badge, the Attention tab's
follow-up buckets, the Calendar's follow-up chips, and the Overview
dashboard's KPIs/suggestions, so any change to what counts as "due" only
needs to happen there.

### Contact-level updates

Contacts (see below) aren't their own stored record, but their update
history doesn't belong to any single deal either — the same person can be
the contact on several deals. So contact updates get their own storage key,
`deal-ledger:contact-updates` (a map of `contactKey` → array of entries,
same shape as a `commLog` entry). `contactKey` is the same identity
`js/contacts.js` already groups by: lowercased name + `'|'` + number (see
`contactKeyOf()` in `js/storage.js`). Opened via the "Updates" button on a
Contacts row, or from a Calendar/Attention follow-up chip.

### Documents

`deal.documents` is an array of `{ id, name, kind, dataUrl|url, mimeType,
size, addedAt }`. `kind` is `'file'` (small upload, stored inline as a
base64 data URL, hard-capped around 350KB — `localStorage` has a real
per-origin ceiling, usually 5–10MB total) or `'link'` (just a URL to
something hosted elsewhere — the right choice for anything bigger). See
`js/documents.js`.

### Metric snapshots (real week-over-week deltas)

`deal-ledger:metric-snapshots` stores one entry per calendar day the app
was opened: `{ date: 'YYYY-MM-DD', metrics: { winRate, avgDealSizeUSD, ... } }`
(see `SNAPSHOT_METRIC_KEYS` in `js/charts.js`). `recordTodaysSnapshotIfNeeded()`
runs once per app load (from `js/app.js`'s init), and `getMetricDelta()`
compares the current value of a metric to the closest snapshot ~7 days back.
If there's no snapshot old enough yet, the delta is simply omitted on the
Overview KPI cards — never fabricated. Kept to the last ~120 days.

### Expenses

Unlike everything else so far, expenses are a genuine top-level entity —
not derived from deals. `deal-ledger:expenses` → array of
`{ id, description, category, amount, currency, date, dealId, createdAt }`.
`dealId` is optional (`null` for general business expenses like software
subscriptions; set when an expense belongs to a specific project). See
`getExpenses()` / `saveExpense()` / `deleteExpense()` in `js/storage.js`,
managed from the **Financial** tab (`js/financial.js`), which also
aggregates every invoice across every deal into one place alongside them.

Money is never double-converted-and-stored: only `value` + `currency` (what was
typed) are saved. Every display computes the other currency live from the
current exchange rate (`getExchangeRate()` in `js/storage.js`), so changing
the rate in Settings instantly updates every total, table, and chart without
touching the original entered amounts.

`Referrals`, `Contacts`, and `Entities` are **not** stored separately —
they're computed on the fly from the deals list (grouped by referral name /
contact name / entity name). One source of truth, no sync bugs. See
`js/referrals.js`, `js/contacts.js`, `js/entities.js`.

`commLog` entries do double duty as "updates" — the Quick Update popup
(`js/updates.js`), the Calendar (`js/calendar.js`), and the detail view's
Updates section all read this same array. There's no separate "events" or
"updates" table.

Dropdown option lists (relation, channel, action, next step, services) live
under `deal-ledger:opts:<key>` — only the options a user *adds* are stored
there; the built-in defaults live in code (`SEED_OPTIONS` in `js/storage.js`)
and are merged in automatically.

## Adding a new dropdown-with-add-your-own field

1. Add a key + default list to `SEED_OPTIONS` in `js/storage.js`.
2. In the HTML, use `<input list="yourKeyOptionsList" ...>` plus an empty
   `<datalist id="yourKeyOptionsList"></datalist>` once anywhere in the page.
3. Call `populateDatalist('yourKeyOptionsList', 'yourKey')` on load and after
   saves (see `js/dropdowns.js`).
4. When saving the form, call `addOption('yourKey', theTypedValue)` so it's
   remembered next time.

## Adding a new field to a deal

Touches three files, each a small, targeted edit:
1. `index.html` — add the input inside the relevant wizard step (`<!-- STEP
   N -->` in the `<!-- DEAL WIZARD MODAL -->` section).
2. `js/deals-wizard.js` — add it to `fillWizardForm()` (so editing shows the
   saved value) and to the object built in the `dealForm` submit handler (so
   it actually gets saved).
3. `js/deals-detail.js` — add a `fieldRow(...)` call in `openDetailModal()`
   if it should show up in the detail popup.

Table columns (`js/deals-table.js`) and calendar/attention logic are
separate, deliberately — only touch those if the new field needs to show up
there too.

## Swapping localStorage for a real backend later

Only `js/storage.js` touches `localStorage`. Everything else calls its
functions (`getDeals`, `saveDeal`, `deleteDeal`, `getOptions`, `addOption`,
`getExchangeRate`/`setExchangeRate`). Replacing the internals with Supabase
calls means editing one file — nothing else in the project needs to change.
