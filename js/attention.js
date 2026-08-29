/* ============================================================
   attention.js
   ------------------------------------------------------------
   The "Needs attention" tab, and the data layer behind the
   Dashboard's own "Needs attention" panel (see today.js).

   This used to be 12 separate category cards (Overdue, Closing
   soon, Follow-ups overdue, Follow-ups due soon, Contact follow-
   ups x2, Invoices x2, Tasks x2, Debts x2, Stalled, Never
   contacted) — every one a different flavor of "something needs
   a look," split apart mostly by which code path produced it
   rather than by how urgent it actually is. That meant the single
   most overdue thing in the business could be buried on card 9
   while card 1 showed something merely "closing soon."

   Now there's ONE ranked list: buildUnifiedAttentionItems() flattens
   every category into a common shape and sorts everything together
   by real urgency — overdue items first (most overdue first),
   then due-soon items (soonest first), then no-date-but-stale
   items last. Nothing here is separately stored — every item is
   computed from fields already on each deal/todo/debt/contact
   update, the same way Referrals/Contacts/Entities are computed
   in their own files. A deal (or contact) can still produce more
   than one row (e.g. overdue AND has an overdue invoice) — that's
   real information, not a bug — it just now sits wherever it
   ranks in the single list instead of being split into two cards.

   buildAttentionGroups() (the raw category buckets) is kept as the
   data layer underneath buildUnifiedAttentionItems() — nothing
   else in the app reads the individual buckets directly anymore.

   Depends on: storage.js (getDeals, timeAgo, lastActivityTimestamp),
   deals-shared.js (isOverdue), updates.js (followUpState,
   collectDealFollowUps, collectContactFollowUps), todos.js
   (getTodos), debts.js (getDebts), deals-detail.js (openDetailModal),
   app.js (switchView).

   Exposes: renderAttention(), getAttentionCounts(),
            buildUnifiedAttentionItems(), unifiedAttentionRow(item)
   ============================================================ */

const STALE_DAYS = 14;
const CLOSING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const attentionSummaryEl = document.getElementById('attentionSummary');
const attentionGroupsEl = document.getElementById('attentionGroups');
const attentionAllClearEl = document.getElementById('attentionAllClear');

function daysSince(ts) {
  if (!ts) return Infinity;
  return (Date.now() - ts) / DAY_MS;
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  return (new Date(dateStr).getTime() - Date.now()) / DAY_MS;
}

function buildAttentionGroups() {
  const openDeals = getDeals().filter(d => d.stage !== 'won' && d.stage !== 'lost');

  const overdue = openDeals.filter(d => isOverdue(d));

  const closingSoon = openDeals.filter(d =>
    !isOverdue(d) && d.closeDate && daysUntil(d.closeDate) >= 0 && daysUntil(d.closeDate) <= CLOSING_SOON_DAYS
  );

  const stalled = openDeals.filter(d => daysSince(lastActivityTimestamp(d)) >= STALE_DAYS);

  const neverContacted = openDeals.filter(d => d.stage === 'new' && (!d.commLog || d.commLog.length === 0));

  const invoicesOverdue = [];
  const invoicesDueSoon = [];
  getDeals().forEach(deal => {
    (deal.invoices || []).forEach(inv => {
      if (inv.status === 'paid' || !inv.dueDate) return;
      const d = daysUntil(inv.dueDate);
      const entry = { deal, invoice: inv, days: d };
      if (d < 0) invoicesOverdue.push(entry);
      else if (d <= CLOSING_SOON_DAYS) invoicesDueSoon.push(entry);
    });
  });

  // Follow-ups: any comm-log entry (deal or contact) with a next-step date
  // that's overdue or coming up soon. Deliberately not filtered to open
  // deals only — a logged follow-up on a won deal still deserves a look.
  const dealFollowUps = collectDealFollowUps();
  const followUpsOverdue = dealFollowUps.filter(f => f.state === 'overdue');
  const followUpsDueSoon = dealFollowUps.filter(f => f.state === 'soon');

  const contactFollowUps = collectContactFollowUps();
  const contactFollowUpsOverdue = contactFollowUps.filter(f => f.state === 'overdue');
  const contactFollowUpsDueSoon = contactFollowUps.filter(f => f.state === 'soon');

  // To-dos and debts feed the same unified board — a to-do due today looks
  // exactly as urgent here as a deal closing today, which is the point.
  const openTodos = getTodos().filter(t => t.status === 'open' && t.dueDate);
  const todosOverdue = openTodos.filter(t => daysUntil(t.dueDate) < 0);
  const todosDueSoon = openTodos.filter(t => daysUntil(t.dueDate) >= 0 && daysUntil(t.dueDate) <= CLOSING_SOON_DAYS);

  const openDebts = (typeof getDebts === 'function' ? getDebts() : []).filter(d => d.status === 'open' && d.dueDate);
  const debtsOverdue = openDebts.filter(d => daysUntil(d.dueDate) < 0);
  const debtsDueSoon = openDebts.filter(d => daysUntil(d.dueDate) >= 0 && daysUntil(d.dueDate) <= CLOSING_SOON_DAYS);

  return {
    overdue, closingSoon, stalled, neverContacted, invoicesOverdue, invoicesDueSoon,
    followUpsOverdue, followUpsDueSoon, contactFollowUpsOverdue, contactFollowUpsDueSoon,
    todosOverdue, todosDueSoon, debtsOverdue, debtsDueSoon,
  };
}


// ---------- Unified ranking ----------
// One flat list, every category folded in, sorted so the single most
// urgent thing in the whole business is always item [0] — regardless of
// whether it's a deal, an invoice, a task, a debt, or a follow-up.
//   tier 0 = overdue (sorted most-overdue first)
//   tier 1 = due within CLOSING_SOON_DAYS (sorted soonest-first)
//   tier 2 = no date, but stale/never-contacted (sorted stalest first)
function followUpDays(entry) {
  const dayMs = 24 * 60 * 60 * 1000;
  return (new Date(entry.nextStepDate + 'T00:00:00') - new Date(new Date().toDateString())) / dayMs;
}

function buildUnifiedAttentionItems() {
  const g = buildAttentionGroups();
  const items = [];

  function overdueItem(fields) { items.push(Object.assign({ tier: 0, tone: 'danger' }, fields)); }
  function soonItem(fields) { items.push(Object.assign({ tier: 1, tone: 'amber' }, fields)); }
  function staleItem(fields) { items.push(Object.assign({ tier: 2 }, fields)); }

  g.overdue.forEach(d => overdueItem({
    metric: -daysUntil(d.closeDate), kind: 'deal', id: d.id, name: d.entityName || 'Untitled entity',
    reason: 'Deal overdue', detail: Math.round(-daysUntil(d.closeDate)) + 'd overdue', icon: 'bi-exclamation-triangle-fill',
  }));
  g.followUpsOverdue.forEach(f => overdueItem({
    metric: -followUpDays(f.entry), kind: 'deal', id: f.deal.id, name: f.deal.entityName || 'Untitled entity',
    reason: 'Follow-up overdue', detail: Math.round(-followUpDays(f.entry)) + 'd overdue', icon: 'bi-alarm-fill',
  }));
  g.contactFollowUpsOverdue.forEach(f => overdueItem({
    metric: -followUpDays(f.entry), kind: 'contact', contactKey: f.contactKey, contactName: f.contactName, name: f.contactName,
    reason: 'Contact follow-up overdue', detail: Math.round(-followUpDays(f.entry)) + 'd overdue', icon: 'bi-person-exclamation',
  }));
  g.invoicesOverdue.forEach(entry => overdueItem({
    metric: -entry.days, kind: 'deal', id: entry.deal.id, name: entry.deal.entityName || 'Untitled entity',
    reason: 'Invoice overdue', detail: entry.invoice.number + ' · ' + Math.round(-entry.days) + 'd overdue', icon: 'bi-receipt',
  }));
  g.todosOverdue.forEach(t => overdueItem({
    metric: -daysUntil(t.dueDate), kind: 'todo', id: t.id, name: t.title,
    reason: 'Task overdue', detail: Math.round(-daysUntil(t.dueDate)) + 'd overdue', icon: 'bi-list-check',
  }));
  g.debtsOverdue.forEach(d => overdueItem({
    metric: -daysUntil(d.dueDate), kind: 'debt', id: d.id, name: d.description,
    reason: 'Debt overdue', detail: Math.round(-daysUntil(d.dueDate)) + 'd overdue', icon: 'bi-credit-card',
  }));

  g.closingSoon.forEach(d => soonItem({
    metric: daysUntil(d.closeDate), kind: 'deal', id: d.id, name: d.entityName || 'Untitled entity',
    reason: 'Closing soon', detail: 'closes in ' + Math.max(0, Math.round(daysUntil(d.closeDate))) + 'd', icon: 'bi-hourglass-split',
  }));
  g.followUpsDueSoon.forEach(f => soonItem({
    metric: followUpDays(f.entry), kind: 'deal', id: f.deal.id, name: f.deal.entityName || 'Untitled entity',
    reason: 'Follow-up due soon', detail: 'due in ' + Math.max(0, Math.round(followUpDays(f.entry))) + 'd', icon: 'bi-bell-fill',
  }));
  g.contactFollowUpsDueSoon.forEach(f => soonItem({
    metric: followUpDays(f.entry), kind: 'contact', contactKey: f.contactKey, contactName: f.contactName, name: f.contactName,
    reason: 'Contact follow-up due soon', detail: 'due in ' + Math.max(0, Math.round(followUpDays(f.entry))) + 'd', icon: 'bi-person-check',
  }));
  g.invoicesDueSoon.forEach(entry => soonItem({
    metric: entry.days, kind: 'deal', id: entry.deal.id, name: entry.deal.entityName || 'Untitled entity',
    reason: 'Invoice due soon', detail: entry.invoice.number + ' · due in ' + Math.max(0, Math.round(entry.days)) + 'd', icon: 'bi-cash-coin',
  }));
  g.todosDueSoon.forEach(t => soonItem({
    metric: daysUntil(t.dueDate), kind: 'todo', id: t.id, name: t.title,
    reason: 'Task due soon', detail: 'due in ' + Math.max(0, Math.round(daysUntil(t.dueDate))) + 'd', icon: 'bi-list-check',
  }));
  g.debtsDueSoon.forEach(d => soonItem({
    metric: daysUntil(d.dueDate), kind: 'debt', id: d.id, name: d.description,
    reason: 'Debt due soon', detail: 'due in ' + Math.max(0, Math.round(daysUntil(d.dueDate))) + 'd', icon: 'bi-credit-card',
  }));

  g.stalled.forEach(d => staleItem({
    metric: -daysSince(lastActivityTimestamp(d)), tone: 'slate', kind: 'deal', id: d.id, name: d.entityName || 'Untitled entity',
    reason: 'Stalled', detail: timeAgo(lastActivityTimestamp(d)) || 'no activity logged', icon: 'bi-moon-stars-fill',
  }));
  g.neverContacted.forEach(d => staleItem({
    metric: -daysSince(d.createdAt), tone: 'cyan', kind: 'deal', id: d.id, name: d.entityName || 'Untitled entity',
    reason: 'Never contacted', detail: 'added ' + (timeAgo(d.createdAt) || 'recently'), icon: 'bi-person-x-fill',
  }));

  items.sort((a, b) => a.tier - b.tier || a.metric - b.metric);
  return items;
}

// A deal id can legitimately show up more than once (e.g. overdue AND has
// an overdue invoice) — the tab badge/KPI counts every reason, matching
// exactly how many rows the person will actually see in the ranked list.
function getAttentionCounts() {
  return buildUnifiedAttentionItems().length;
}

function unifiedAttentionRow(item) {
  const idAttr = item.kind === 'deal' ? 'data-id="' + item.id + '"'
    : item.kind === 'todo' ? 'data-todo-id="' + item.id + '"'
    : item.kind === 'debt' ? 'data-debt-id="' + item.id + '"'
    : 'data-contact-key="' + escapeHtml(item.contactKey) + '" data-contact-name="' + escapeHtml(item.contactName) + '"';
  return '' +
    '<button type="button" class="attention-row attention-row--icon" ' + idAttr + '>' +
      '<span class="attention-row__icon-badge attention-row__icon-badge--' + item.tone + '"><i class="bi ' + item.icon + '"></i></span>' +
      '<span class="attention-row__stack">' +
        '<span class="attention-row__name" title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>' +
        '<span class="attention-row__context attention-row__context--' + item.tone + '">' + escapeHtml(item.reason) + ' · ' + escapeHtml(item.detail) + '</span>' +
      '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

const ATTENTION_TIER_META = [
  { label: 'Overdue', icon: 'bi-exclamation-circle', tone: 'danger' },
  { label: 'Due soon', icon: 'bi-hourglass-split', tone: 'amber' },
  { label: 'Needs a look', icon: 'bi-moon-stars', tone: 'slate' },
];

function renderAttention() {
  const items = buildUnifiedAttentionItems();
  const byTier = [0, 1, 2].map(tier => items.filter(i => i.tier === tier));

  attentionSummaryEl.innerHTML = ATTENTION_TIER_META.map((meta, tier) =>
    '<div class="attention-stat attention-stat--' + meta.tone + '">' +
      '<i class="bi ' + meta.icon + '"></i>' +
      '<span class="attention-stat__figure">' + byTier[tier].length + '</span>' +
      '<span class="attention-stat__label">' + meta.label + '</span>' +
    '</div>'
  ).join('');

  if (items.length === 0) {
    attentionGroupsEl.innerHTML = '';
    attentionAllClearEl.classList.remove('d-none');
    return;
  }
  attentionAllClearEl.classList.add('d-none');

  attentionGroupsEl.innerHTML = ATTENTION_TIER_META.map((meta, tier) => {
    const tierItems = byTier[tier];
    if (!tierItems.length) return '';
    return '' +
      '<div class="attention-tier">' +
        '<h3 class="attention-tier__title"><i class="bi ' + meta.icon + '"></i>' + meta.label + '<span class="chip-count">' + tierItems.length + '</span></h3>' +
        '<div class="attention-list">' + tierItems.map(unifiedAttentionRow).join('') + '</div>' +
      '</div>';
  }).join('');
}

// Handles every row kind the unified list can produce — deal, contact,
// task, or debt — dispatching to that thing's own editor/detail view.
attentionGroupsEl.addEventListener('click', (e) => {
  const contactBtn = e.target.closest('.attention-row[data-contact-key]');
  if (contactBtn) {
    switchView('contacts');
    openContactUpdateModal(contactBtn.dataset.contactKey, contactBtn.dataset.contactName);
    return;
  }
  const todoBtn = e.target.closest('.attention-row[data-todo-id]');
  if (todoBtn) {
    switchView('todos');
    openTodoModal(todoBtn.dataset.todoId);
    return;
  }
  const debtBtn = e.target.closest('.attention-row[data-debt-id]');
  if (debtBtn) {
    switchView('debts');
    openDebtModal(debtBtn.dataset.debtId);
    return;
  }
  const btn = e.target.closest('.attention-row[data-id]');
  if (!btn) return;
  switchView('deals');
  openDetailModal(btn.dataset.id);
});
