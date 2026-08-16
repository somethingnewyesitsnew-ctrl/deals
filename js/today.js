/* ============================================================
   today.js
   ------------------------------------------------------------
   The landing tab — internally still called "today" (ids like
   #todayView, functions like renderToday()) for historical
   reasons, but it's now the single-screen Dashboard: a KPI strip,
   three compact panels (Needs attention / Today & upcoming /
   Pipeline by stage), and a condensed recent-deals table. Nothing
   here is stored — everything is read live from deals (via
   storage.js), attention.js's buckets, and updates.js's follow-up
   helpers, the same way every other computed view in this app
   works. Each panel is capped at a handful of rows with its own
   scroll, specifically so the page itself doesn't need to scroll
   to see "everything" — click any row, or a panel's "View all",
   to drill into the full tab or the deal's own detail popup.

   Depends on: storage.js, updates.js (statusBadge, relativeDayLabel,
   entryDateKey, followUpState), attention.js (buildAttentionGroups,
   getAttentionCounts), deals-shared.js (formatIndex, relationshipDot,
   isOverdue), deals-detail.js (openDetailModal), app.js (switchView).

   Exposes: renderToday(), buildTodaySections()
   ============================================================ */

const todayGreetingEl = document.getElementById('todayGreeting');
const todayStatsEl = document.getElementById('todayStats');
const dashAttentionListEl = document.getElementById('dashAttentionList');
const dashTodayListEl = document.getElementById('dashTodayList');
const dashStageBarEl = document.getElementById('dashStageBar');
const dashDealsTableEl = document.getElementById('dashDealsTable');

function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------- "Today & upcoming" data (still used by app.js's tab badge) ----------
function collectAllUpdates() {
  const list = [];
  getDeals().forEach(deal => {
    (deal.commLog || []).forEach(entry => {
      const key = entryDateKey(entry);
      if (!key) return;
      list.push({
        dealId: deal.id,
        entityName: deal.entityName || 'Untitled entity',
        stage: deal.stage,
        key,
        note: entry.note || entry.action || entry.channel || 'Update',
        status: entry.status || '',
        datetime: entry.datetime,
      });
    });
  });
  return list;
}

function buildTodaySections() {
  const all = collectAllUpdates();
  const now = new Date();
  const todayKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const upcomingLimit = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const todayItems = all
    .filter(u => u.key === todayKey)
    .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''));

  const upcomingItems = all
    .filter(u => {
      if (u.key === todayKey) return false;
      const d = new Date(u.key + 'T00:00:00');
      return d > startOfToday && d <= upcomingLimit;
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return { todayItems, upcomingItems };
}

// ---------- KPI strip ----------
function renderDashboardStats() {
  const deals = getDeals();
  const openDeals = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  const openValueUSD = openDeals.reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  const wonUSD = deals.filter(d => d.stage === 'won').reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  let collectedUSD = 0;
  deals.forEach(d => (d.invoices || []).forEach(inv => {
    if (inv.status === 'paid') collectedUSD += toUSD(invoiceTotal(inv.items), inv.currency);
  }));

  const { todayItems } = buildTodaySections();
  const attentionCount = typeof getAttentionCounts === 'function' ? getAttentionCounts() : 0;

  todayStatsEl.innerHTML = [
    { label: 'Deals', figure: deals.length, icon: 'bi-collection', tone: 'slate', view: 'deals' },
    { label: 'Open pipeline', figure: formatUSD(openValueUSD), icon: 'bi-graph-up', tone: 'cyan', view: 'deals' },
    { label: 'Won', figure: formatUSD(wonUSD), icon: 'bi-trophy', tone: 'green', view: 'deals' },
    { label: 'Collected', figure: formatUSD(collectedUSD), icon: 'bi-cash-stack', tone: 'green', view: 'deals' },
    { label: 'Needs attention', figure: attentionCount, icon: 'bi-bell', tone: attentionCount > 0 ? 'danger' : 'slate', view: 'attention', highlight: attentionCount > 0 },
    { label: 'Scheduled today', figure: todayItems.length, icon: 'bi-sun', tone: 'amber', view: 'calendar' },
  ].map(s =>
    '<button type="button" class="attention-stat attention-stat--' + s.tone + (s.highlight ? ' attention-stat--highlight' : '') + ' attention-stat--clickable" data-jump-view="' + s.view + '">' +
      '<i class="bi ' + s.icon + '"></i>' +
      '<span class="attention-stat__figure">' + s.figure + '</span>' +
      '<span class="attention-stat__label">' + s.label + '</span>' +
    '</button>'
  ).join('');
}

// ---------- "Needs attention" panel: merges every attention.js bucket into one glanceable list ----------
const ATTENTION_REASON_META = {
  'Overdue': { icon: 'bi-exclamation-triangle-fill', tone: 'danger' },
  'Follow-up overdue': { icon: 'bi-alarm-fill', tone: 'danger' },
  'Invoice overdue': { icon: 'bi-receipt', tone: 'danger' },
  'Task overdue': { icon: 'bi-list-check', tone: 'danger' },
  'Debt overdue': { icon: 'bi-credit-card', tone: 'danger' },
  'Closing soon': { icon: 'bi-hourglass-split', tone: 'amber' },
  'Follow-up due soon': { icon: 'bi-bell-fill', tone: 'amber' },
  'Invoice due soon': { icon: 'bi-cash-coin', tone: 'amber' },
  'Task due soon': { icon: 'bi-list-check', tone: 'amber' },
  'Debt due soon': { icon: 'bi-credit-card', tone: 'amber' },
  'Stalled': { icon: 'bi-moon-stars-fill', tone: 'slate' },
  'Never contacted': { icon: 'bi-person-x-fill', tone: 'cyan' },
};

function buildDashboardAttentionItems(limit) {
  const g = typeof buildAttentionGroups === 'function' ? buildAttentionGroups() : null;
  if (!g) return [];
  const items = [];
  const seenDealIds = new Set();

  function addDeals(list, label, getDeal) {
    list.forEach(entry => {
      const deal = getDeal(entry);
      if (!deal || seenDealIds.has(deal.id)) return;
      seenDealIds.add(deal.id);
      items.push({ kind: 'deal', deal, label });
    });
  }

  addDeals(g.overdue, 'Overdue', d => d);
  addDeals(g.followUpsOverdue, 'Follow-up overdue', f => f.deal);
  addDeals(g.invoicesOverdue, 'Invoice overdue', e => e.deal);
  addDeals(g.closingSoon, 'Closing soon', d => d);
  addDeals(g.followUpsDueSoon, 'Follow-up due soon', f => f.deal);
  addDeals(g.invoicesDueSoon, 'Invoice due soon', e => e.deal);
  addDeals(g.stalled, 'Stalled', d => d);
  addDeals(g.neverContacted, 'Never contacted', d => d);

  const seenTodoIds = new Set();
  function addTodos(list, label) {
    list.forEach(todo => {
      if (seenTodoIds.has(todo.id)) return;
      seenTodoIds.add(todo.id);
      items.push({ kind: 'todo', todo, label });
    });
  }
  addTodos(g.todosOverdue, 'Task overdue');
  addTodos(g.todosDueSoon, 'Task due soon');

  const seenDebtIds = new Set();
  function addDebts(list, label) {
    list.forEach(debt => {
      if (seenDebtIds.has(debt.id)) return;
      seenDebtIds.add(debt.id);
      items.push({ kind: 'debt', debt, label });
    });
  }
  addDebts(g.debtsOverdue, 'Debt overdue');
  addDebts(g.debtsDueSoon, 'Debt due soon');

  return items.slice(0, limit || 7);
}

function renderDashboardAttentionPanel() {
  const items = buildDashboardAttentionItems(7);
  dashAttentionListEl.innerHTML = items.length
    ? items.map(it => {
        const meta = ATTENTION_REASON_META[it.label] || { icon: 'bi-flag-fill', tone: 'slate' };
        const name = it.kind === 'deal' ? (it.deal.entityName || 'Untitled entity')
          : it.kind === 'todo' ? it.todo.title
          : it.debt.description;
        const idAttr = it.kind === 'deal' ? 'data-id="' + it.deal.id + '"'
          : it.kind === 'todo' ? 'data-todo-id="' + it.todo.id + '"'
          : 'data-debt-id="' + it.debt.id + '"';
        return '<button type="button" class="attention-row attention-row--icon" ' + idAttr + '>' +
          '<span class="attention-row__icon-badge attention-row__icon-badge--' + meta.tone + '"><i class="bi ' + meta.icon + '"></i></span>' +
          '<span class="attention-row__stack">' +
            '<span class="attention-row__name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
            '<span class="attention-row__context attention-row__context--' + meta.tone + '">' + escapeHtml(it.label) + '</span>' +
          '</span>' +
          '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
        '</button>';
      }).join('')
    : '<p class="attention-clear"><i class="bi bi-check-lg"></i>All clear</p>';
}

// ---------- "Today & upcoming" panel ----------
function updateRow(u, dayLabelOverride) {
  const time = (u.datetime && u.datetime.includes('T'))
    ? new Date(u.datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';
  const dayLabel = dayLabelOverride || (u.key === (new Date().toISOString().slice(0, 10)) ? 'Today' : relativeDayLabel(u.key));
  return '' +
    '<button type="button" class="attention-row attention-row--time" data-id="' + u.dealId + '">' +
      '<span class="attention-row__timeblock">' +
        '<span class="attention-row__timeblock-day">' + escapeHtml(dayLabel) + '</span>' +
        (time ? '<span class="attention-row__timeblock-time">' + escapeHtml(time) + '</span>' : '<span class="attention-row__timeblock-time attention-row__timeblock-time--muted">—</span>') +
      '</span>' +
      '<span class="attention-row__stack">' +
        '<span class="attention-row__name">' + escapeHtml(u.entityName) + '</span>' +
        '<span class="attention-row__note">' + escapeHtml(u.note) + '</span>' +
      '</span>' +
      statusBadge(u.status) +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function renderDashboardTodayPanel() {
  const { todayItems, upcomingItems } = buildTodaySections();
  const combined = todayItems.concat(upcomingItems).slice(0, 7);
  dashTodayListEl.innerHTML = combined.length
    ? combined.map(u => updateRow(u)).join('')
    : '<p class="attention-clear"><i class="bi bi-check-lg"></i>Nothing scheduled this week</p>';
}

// ---------- "Pipeline by stage" mini bar (plain CSS, no chart library — kept
// tiny on purpose so it fits the dashboard's compact panel) ----------
function renderDashboardStageBar() {
  const deals = getDeals();
  const order = ['new', 'contacted', 'proposal', 'negotiation', 'won', 'lost'];
  const labels = { new: 'New', contacted: 'Contacted', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
  const sums = order.map(stage => deals.filter(d => d.stage === stage).reduce((s, d) => s + toUSD(d.value, d.currency), 0));
  const total = sums.reduce((a, b) => a + b, 0);

  if (total <= 0) {
    dashStageBarEl.innerHTML = '<p class="chart-empty">No deal value recorded yet.</p>';
    return;
  }

  const segments = order.map((stage, i) =>
    '<div class="dash-stagebar__seg dash-stagebar__seg--' + stage + '" style="width:' + Math.max(1, (sums[i] / total) * 100) + '%" title="' + labels[stage] + ': ' + formatUSD(sums[i]) + '"></div>'
  ).join('');

  const legend = order.map((stage, i) =>
    '<div class="dash-stagebar__legend-row">' +
      '<span class="dash-stagebar__dot dash-stagebar__seg--' + stage + '"></span>' +
      '<span class="dash-stagebar__legend-label">' + labels[stage] + '</span>' +
      '<span class="dash-stagebar__legend-value">' + formatUSD(sums[i]) + '</span>' +
    '</div>'
  ).join('');

  dashStageBarEl.innerHTML = '<div class="dash-stagebar">' + segments + '</div><div class="dash-stagebar__legend">' + legend + '</div>';
}

// ---------- Compact recent-deals table ----------
function renderDashboardDealsTable() {
  const deals = getDeals().slice().sort((a, b) => (lastActivityTimestamp(b) || 0) - (lastActivityTimestamp(a) || 0)).slice(0, 8);

  if (deals.length === 0) {
    dashDealsTableEl.innerHTML = '<p class="chart-empty">No deals recorded yet.</p>';
    return;
  }

  const rows = deals.map(deal => {
    const overdue = typeof isOverdue === 'function' && isOverdue(deal);
    const closeLabel = deal.closeDate
      ? new Date(deal.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—';
    return '' +
      '<button type="button" class="dash-mini-row" data-id="' + deal.id + '">' +
        '<span class="dash-mini-row__name">' + escapeHtml(deal.entityName || 'Untitled entity') + '</span>' +
        '<span class="stage-badge stage-badge--' + deal.stage + '">' + deal.stage + '</span>' +
        '<span class="dash-mini-row__value">' + formatUSD(toUSD(deal.value, deal.currency)) + '</span>' +
        '<span class="dash-mini-row__close' + (overdue ? ' dash-mini-row__close--overdue' : '') + '">' + closeLabel + '</span>' +
        '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
      '</button>';
  }).join('');

  dashDealsTableEl.innerHTML = '<div class="dash-mini-table">' + rows + '</div>';
}

// ---------- Orchestration ----------
function renderToday() {
  todayGreetingEl.textContent = greetingWord() + ' — ' +
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  renderDashboardStats();
  renderDashboardAttentionPanel();
  renderDashboardTodayPanel();
  renderDashboardStageBar();
  renderDashboardDealsTable();
}

// ---------- Shared interactions ----------
document.getElementById('todayView').addEventListener('click', (e) => {
  const jumpBtn = e.target.closest('[data-jump-view]');
  if (jumpBtn) { switchView(jumpBtn.dataset.jumpView); return; }

  const todoRow = e.target.closest('.attention-row[data-todo-id]');
  if (todoRow) { switchView('todos'); openTodoModal(todoRow.dataset.todoId); return; }

  const debtRow = e.target.closest('.attention-row[data-debt-id]');
  if (debtRow) { switchView('debts'); openDebtModal(debtRow.dataset.debtId); return; }

  const row = e.target.closest('.attention-row[data-id], .dash-mini-row[data-id]');
  if (!row) return;
  switchView('deals');
  openDetailModal(row.dataset.id);
});
