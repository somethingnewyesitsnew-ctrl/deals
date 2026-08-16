/* ============================================================
   attention.js
   ------------------------------------------------------------
   The "Needs attention" tab. Nothing here is separately stored —
   every bucket is computed from fields already on each deal
   (stage, closeDate, commLog, updatedAt), the same way Referrals/
   Contacts/Entities are computed in directory.js. A deal can land
   in more than one bucket; that's intentional, each bucket answers
   a different question.

   Buckets:
     - Overdue        — expected close date has passed, still open
     - Closing soon    — expected close within the next 7 days
     - Stalled         — no logged activity in 14+ days, still open
     - Never contacted — stage is "New" and no comm log entries yet

   Depends on: storage.js (getDeals, timeAgo, lastActivityTimestamp),
   deals.js (isOverdue, openDetailModal, formatDualCurrency helpers
   available globally), app.js (switchView).

   Exposes: renderAttention(), getAttentionCounts()
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

function getAttentionCounts() {
  const g = buildAttentionGroups();
  // A deal can appear in multiple buckets, but the tab badge should read
  // as "N deals need a look", not double-count the same deal twice.
  const uniqueIds = new Set();
  [g.overdue, g.closingSoon, g.stalled, g.neverContacted].forEach(list =>
    list.forEach(d => uniqueIds.add(d.id))
  );
  [g.invoicesOverdue, g.invoicesDueSoon].forEach(list =>
    list.forEach(item => uniqueIds.add(item.deal.id))
  );
  [g.followUpsOverdue, g.followUpsDueSoon].forEach(list =>
    list.forEach(item => uniqueIds.add(item.deal.id))
  );
  // Contact follow-ups aren't tied to a deal id, so they get their own
  // count added on top rather than folded into the dedup set above.
  const contactCount = new Set([...g.contactFollowUpsOverdue, ...g.contactFollowUpsDueSoon].map(f => f.contactKey)).size;
  const todoCount = new Set([...g.todosOverdue, ...g.todosDueSoon].map(t => t.id)).size;
  const debtCount = new Set([...g.debtsOverdue, ...g.debtsDueSoon].map(d => d.id)).size;
  return uniqueIds.size + contactCount + todoCount + debtCount;
}

function attentionRow(deal, contextLabel) {
  return '' +
    '<button type="button" class="attention-row" data-id="' + deal.id + '">' +
      '<span class="attention-row__name" title="' + escapeHtml(deal.entityName || 'Untitled entity') + '">' + escapeHtml(deal.entityName || 'Untitled entity') + '</span>' +
      '<span class="attention-row__stage stage-badge stage-badge--' + deal.stage + '">' + deal.stage + '</span>' +
      '<span class="attention-row__context">' + contextLabel + '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function invoiceAttentionRow(entry, contextLabel) {
  const total = invoiceTotal(entry.invoice.items);
  return '' +
    '<button type="button" class="attention-row" data-id="' + entry.deal.id + '">' +
      '<span class="attention-row__name" title="' + escapeHtml(entry.deal.entityName || 'Untitled entity') + '">' + escapeHtml(entry.deal.entityName || 'Untitled entity') + '</span>' +
      '<span class="attention-row__note">' + escapeHtml(entry.invoice.number) + ' · ' + formatInvoiceAmount(total, entry.invoice.currency) + '</span>' +
      '<span class="attention-row__context">' + contextLabel + '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function followUpAttentionRow(entry, contextLabel) {
  const note = entry.entry.nextStep || entry.entry.note || 'Follow up';
  return '' +
    '<button type="button" class="attention-row" data-id="' + entry.deal.id + '">' +
      '<span class="attention-row__name" title="' + escapeHtml(entry.deal.entityName || 'Untitled entity') + '">' + escapeHtml(entry.deal.entityName || 'Untitled entity') + '</span>' +
      '<span class="attention-row__note">' + escapeHtml(note) + '</span>' +
      '<span class="attention-row__context">' + contextLabel + '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function contactFollowUpAttentionRow(entry, contextLabel) {
  const note = entry.entry.nextStep || entry.entry.note || 'Follow up';
  return '' +
    '<button type="button" class="attention-row" data-contact-key="' + escapeHtml(entry.contactKey) + '" data-contact-name="' + escapeHtml(entry.contactName) + '">' +
      '<span class="attention-row__name" title="' + escapeHtml(entry.contactName) + '">' + escapeHtml(entry.contactName) + '</span>' +
      '<span class="attention-row__note">' + escapeHtml(note) + '</span>' +
      '<span class="attention-row__context">' + contextLabel + '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function todoAttentionRow(todo, contextLabel) {
  return '' +
    '<button type="button" class="attention-row" data-todo-id="' + todo.id + '">' +
      '<span class="attention-row__name" title="' + escapeHtml(todo.title) + '">' + escapeHtml(todo.title) + '</span>' +
      '<span class="attention-row__context">' + contextLabel + '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function debtAttentionRow(debt, contextLabel) {
  return '' +
    '<button type="button" class="attention-row" data-debt-id="' + debt.id + '">' +
      '<span class="attention-row__name" title="' + escapeHtml(debt.description) + '">' + escapeHtml(debt.description) + '</span>' +
      '<span class="attention-row__note">' + formatInvoiceAmount(debt.amount, debt.currency) + '</span>' +
      '<span class="attention-row__context">' + contextLabel + '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function renderAttentionGroup(key, title, icon, tone, items, contextFn, rowFn, noun) {
  rowFn = rowFn || attentionRow;
  noun = noun || 'deal';
  const rows = items.slice(0, 8).map(it => rowFn(it, contextFn(it))).join('');
  const overflow = items.length > 8 ? '<div class="attention-overflow">+ ' + (items.length - 8) + ' more</div>' : '';

  return '' +
    '<div class="attention-card attention-card--' + tone + '">' +
      '<div class="attention-card__head">' +
        '<span class="attention-card__icon"><i class="bi ' + icon + '"></i></span>' +
        '<div>' +
          '<h3>' + title + '</h3>' +
          '<p>' + items.length + ' ' + noun + (items.length === 1 ? '' : 's') + '</p>' +
        '</div>' +
      '</div>' +
      (items.length
        ? '<div class="attention-list">' + rows + overflow + '</div>'
        : '<p class="attention-clear"><i class="bi bi-check-lg"></i>None right now</p>') +
    '</div>';
}

function followUpDays(entry) {
  const dayMs = 24 * 60 * 60 * 1000;
  return (new Date(entry.nextStepDate + 'T00:00:00') - new Date(new Date().toDateString())) / dayMs;
}

function renderAttention() {
  const groups = buildAttentionGroups();
  const total = getAttentionCounts();

  attentionSummaryEl.innerHTML = [
    ['Overdue', groups.overdue.length, 'bi-exclamation-circle', 'danger'],
    ['Closing soon', groups.closingSoon.length, 'bi-hourglass-split', 'amber'],
    ['Stalled', groups.stalled.length, 'bi-moon-stars', 'slate'],
    ['Never contacted', groups.neverContacted.length, 'bi-person-x', 'cyan'],
    ['Follow-ups overdue', groups.followUpsOverdue.length + groups.contactFollowUpsOverdue.length, 'bi-alarm', 'danger'],
    ['Follow-ups due soon', groups.followUpsDueSoon.length + groups.contactFollowUpsDueSoon.length, 'bi-bell', 'amber'],
    ['Invoices overdue', groups.invoicesOverdue.length, 'bi-receipt', 'danger'],
    ['Invoices due soon', groups.invoicesDueSoon.length, 'bi-cash-coin', 'amber'],
    ['Tasks overdue', groups.todosOverdue.length, 'bi-list-check', 'danger'],
    ['Tasks due soon', groups.todosDueSoon.length, 'bi-list-check', 'amber'],
    ['Debts overdue', groups.debtsOverdue.length, 'bi-credit-card', 'danger'],
    ['Debts due soon', groups.debtsDueSoon.length, 'bi-credit-card', 'amber'],
  ].map(([label, count, icon, tone]) =>
    '<div class="attention-stat attention-stat--' + tone + '">' +
      '<i class="bi ' + icon + '"></i>' +
      '<span class="attention-stat__figure">' + count + '</span>' +
      '<span class="attention-stat__label">' + label + '</span>' +
    '</div>'
  ).join('');

  if (total === 0) {
    attentionGroupsEl.innerHTML = '';
    attentionAllClearEl.classList.remove('d-none');
    return;
  }
  attentionAllClearEl.classList.add('d-none');

  attentionGroupsEl.innerHTML = [
    renderAttentionGroup('overdue', 'Overdue', 'bi-exclamation-circle', 'danger', groups.overdue,
      d => (Math.round(-daysUntil(d.closeDate)) + 'd overdue')),
    renderAttentionGroup('closingSoon', 'Closing soon', 'bi-hourglass-split', 'amber', groups.closingSoon,
      d => ('closes in ' + Math.max(0, Math.round(daysUntil(d.closeDate))) + 'd')),
    renderAttentionGroup('followUpsOverdue', 'Follow-ups overdue', 'bi-alarm', 'danger', groups.followUpsOverdue,
      f => (Math.round(-followUpDays(f.entry)) + 'd overdue'), followUpAttentionRow, 'follow-up'),
    renderAttentionGroup('followUpsDueSoon', 'Follow-ups due soon', 'bi-bell', 'amber', groups.followUpsDueSoon,
      f => ('due in ' + Math.max(0, Math.round(followUpDays(f.entry))) + 'd'), followUpAttentionRow, 'follow-up'),
    renderAttentionGroup('contactFollowUpsOverdue', 'Contact follow-ups overdue', 'bi-person-exclamation', 'danger', groups.contactFollowUpsOverdue,
      f => (Math.round(-followUpDays(f.entry)) + 'd overdue'), contactFollowUpAttentionRow, 'contact'),
    renderAttentionGroup('contactFollowUpsDueSoon', 'Contact follow-ups due soon', 'bi-person-check', 'amber', groups.contactFollowUpsDueSoon,
      f => ('due in ' + Math.max(0, Math.round(followUpDays(f.entry))) + 'd'), contactFollowUpAttentionRow, 'contact'),
    renderAttentionGroup('stalled', 'Stalled', 'bi-moon-stars', 'slate', groups.stalled,
      d => (timeAgo(lastActivityTimestamp(d)) || 'no activity logged')),
    renderAttentionGroup('neverContacted', 'Never contacted', 'bi-person-x', 'cyan', groups.neverContacted,
      d => ('added ' + (timeAgo(d.createdAt) || 'recently'))),
    renderAttentionGroup('invoicesOverdue', 'Invoices overdue', 'bi-receipt', 'danger', groups.invoicesOverdue,
      entry => (Math.round(-entry.days) + 'd overdue'), invoiceAttentionRow, 'invoice'),
    renderAttentionGroup('invoicesDueSoon', 'Invoices due soon', 'bi-cash-coin', 'amber', groups.invoicesDueSoon,
      entry => ('due in ' + Math.max(0, Math.round(entry.days)) + 'd'), invoiceAttentionRow, 'invoice'),
    renderAttentionGroup('todosOverdue', 'Tasks overdue', 'bi-list-check', 'danger', groups.todosOverdue,
      t => (Math.round(-daysUntil(t.dueDate)) + 'd overdue'), todoAttentionRow, 'task'),
    renderAttentionGroup('todosDueSoon', 'Tasks due soon', 'bi-list-check', 'amber', groups.todosDueSoon,
      t => ('due in ' + Math.max(0, Math.round(daysUntil(t.dueDate))) + 'd'), todoAttentionRow, 'task'),
    renderAttentionGroup('debtsOverdue', 'Debts overdue', 'bi-credit-card', 'danger', groups.debtsOverdue,
      d => (Math.round(-daysUntil(d.dueDate)) + 'd overdue'), debtAttentionRow, 'debt'),
    renderAttentionGroup('debtsDueSoon', 'Debts due soon', 'bi-credit-card', 'amber', groups.debtsDueSoon,
      d => ('due in ' + Math.max(0, Math.round(daysUntil(d.dueDate))) + 'd'), debtAttentionRow, 'debt'),
  ].join('');
}

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
