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
  const collectedUSD = getTotalCollectedUSD();

  const { todayItems } = buildTodaySections();
  const attentionCount = typeof getAttentionCounts === 'function' ? getAttentionCounts() : 0;

  // Deliberately restrained palette: gray by default, green only for
  // money you've actually earned, red only for the one tile that's
  // genuinely urgent (and only when there's something in it). Every
  // tile having its own color turned this into a rainbow strip that
  // fought for attention instead of directing it — a KPI row should
  // make the ONE thing that needs a look obvious, not compete with five
  // others that don't.
  todayStatsEl.innerHTML = [
    { label: 'Deals', figure: deals.length, icon: 'bi-collection', tone: 'slate', view: 'deals' },
    { label: 'Open pipeline', figure: formatUSD(openValueUSD), icon: 'bi-graph-up', tone: 'cyan', view: 'deals' },
    { label: 'Won', figure: formatUSD(wonUSD), icon: 'bi-trophy', tone: 'green', view: 'deals' },
    { label: 'Collected', figure: formatUSD(collectedUSD), icon: 'bi-cash-stack', tone: 'green', view: 'deals' },
    { label: 'Needs attention', figure: attentionCount, icon: 'bi-bell', tone: attentionCount > 0 ? 'danger' : 'slate', view: 'attention', highlight: attentionCount > 0 },
    { label: 'Scheduled today', figure: todayItems.length, icon: 'bi-sun', tone: 'slate', view: 'calendar' },
  ].map(s =>
    '<button type="button" class="attention-stat attention-stat--' + s.tone + (s.highlight ? ' attention-stat--highlight' : '') + ' attention-stat--clickable" data-jump-view="' + s.view + '">' +
      '<i class="bi ' + s.icon + '"></i>' +
      '<span class="attention-stat__figure">' + s.figure + '</span>' +
      '<span class="attention-stat__label">' + s.label + '</span>' +
    '</button>'
  ).join('');
}

// ---------- "Needs attention" feed — a mockup-style dot+title+subtitle
// row with a right-aligned date and action link, reusing the same
// ranked data as the full Attention tab (see attention.js) but rendered
// with this screen's own compact row shape rather than attention.js's
// full priority cards. ATTENTION_ACTION_LABEL is defined in attention.js
// (loaded first) and shared so the two screens never word an action
// differently for the same reason. ----------
function dashFeedRow(item) {
  const idAttr = item.kind === 'deal' ? 'data-id="' + item.id + '"'
    : item.kind === 'todo' ? 'data-todo-id="' + item.id + '"'
    : item.kind === 'debt' ? 'data-debt-id="' + item.id + '"'
    : 'data-contact-key="' + escapeHtml(item.contactKey) + '" data-contact-name="' + escapeHtml(item.contactName) + '"';
  return '' +
    '<button type="button" class="dash-feed-row" ' + idAttr + '>' +
      '<span class="dash-feed-row__main">' +
        '<span class="dash-feed-row__dot dash-feed-row__dot--' + item.tone + '"></span>' +
        '<span class="dash-feed-row__text">' +
          '<span class="dash-feed-row__title">' + escapeHtml(item.name) + '</span>' +
          '<span class="dash-feed-row__subtitle">' + escapeHtml(item.reason) + '</span>' +
        '</span>' +
      '</span>' +
      '<span class="dash-feed-row__side">' +
        '<span class="dash-feed-row__date">' + escapeHtml(item.detail) + '</span>' +
        '<span class="dash-feed-row__action">' + (ATTENTION_ACTION_LABEL[item.reason] || 'View') + '</span>' +
      '</span>' +
    '</button>';
}

function renderDashboardAttentionPanel() {
  const items = typeof buildUnifiedAttentionItems === 'function' ? buildUnifiedAttentionItems().slice(0, 8) : [];
  dashAttentionListEl.innerHTML = items.length
    ? items.map(dashFeedRow).join('')
    : '<p class="attention-clear"><i class="bi bi-check-lg"></i>All clear</p>';
}

// ---------- Mini calendar widget — a real (not decorative) month grid:
// today highlighted solid, days with logged updates get a small dot,
// click a day to open it (reuses calendar.js's openDayUpdatesModal /
// buildCalendarEntries — same data, same modal, just a smaller grid). ----------
let dashCalMonth = firstOfMonth(new Date());

function renderDashCalendarWidget() {
  const titleEl = document.getElementById('dashCalTitle');
  const gridEl = document.getElementById('dashCalGrid');
  const upcomingEl = document.getElementById('dashCalUpcoming');
  if (!titleEl || !gridEl || !upcomingEl) return;

  titleEl.textContent = dashCalMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const entries = typeof buildCalendarEntries === 'function' ? buildCalendarEntries() : new Map();
  const year = dashCalMonth.getFullYear();
  const month = dashCalMonth.getMonth();
  const mondayFirstOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Mon-first week, matching the mockup
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const now = new Date();
  const todayKey = dateKeyOf(now.getFullYear(), now.getMonth(), now.getDate());

  const cells = [];
  for (let i = mondayFirstOffset - 1; i >= 0; i--) cells.push({ num: daysInPrevMonth - i, key: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ num: d, key: dateKeyOf(year, month, d) });
  let trail = 1;
  while (cells.length % 7 !== 0) cells.push({ num: trail++, key: null });

  const weekdayHeaders = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(w => '<div class="dash-cal-weekday">' + w + '</div>').join('');

  const dayCells = cells.map(cell => {
    if (!cell.key) return '<div class="dash-cal-day dash-cal-day--muted">' + cell.num + '</div>';
    const dayEntries = entries.get(cell.key) || [];
    const isToday = cell.key === todayKey;
    return '<button type="button" class="dash-cal-day' + (isToday ? ' dash-cal-day--today' : '') + (dayEntries.length ? ' dash-cal-day--has-items' : '') + '" data-date="' + cell.key + '">' +
      cell.num + (dayEntries.length ? '<span class="dash-cal-day__dot"></span>' : '') +
    '</button>';
  }).join('');

  gridEl.innerHTML = weekdayHeaders + dayCells;

  const { todayItems } = buildTodaySections();
  if (!todayItems.length) {
    upcomingEl.innerHTML = '<p class="dash-cal-upcoming-empty">Nothing scheduled today.</p>';
  } else {
    const next = todayItems[0];
    const time = (next.datetime && next.datetime.includes('T'))
      ? new Date(next.datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    upcomingEl.innerHTML =
      '<button type="button" class="dash-cal-upcoming-item" data-id="' + next.dealId + '">' +
        '<span class="dash-cal-upcoming-item__bar"></span>' +
        '<span><span class="dash-cal-upcoming-item__title">' + escapeHtml(next.entityName) + '</span><br>' +
        '<span class="dash-cal-upcoming-item__time">' + escapeHtml(next.note) + (time ? ' · ' + escapeHtml(time) : '') + '</span></span>' +
      '</button>' +
      (todayItems.length > 1 ? '<p class="dash-cal-upcoming-more">+' + (todayItems.length - 1) + ' more today</p>' : '');
  }
}

document.getElementById('dashCalPrevBtn').addEventListener('click', () => {
  dashCalMonth = new Date(dashCalMonth.getFullYear(), dashCalMonth.getMonth() - 1, 1);
  renderDashCalendarWidget();
});
document.getElementById('dashCalNextBtn').addEventListener('click', () => {
  dashCalMonth = new Date(dashCalMonth.getFullYear(), dashCalMonth.getMonth() + 1, 1);
  renderDashCalendarWidget();
});
document.getElementById('dashCalGrid').addEventListener('click', (e) => {
  const cell = e.target.closest('.dash-cal-day[data-date]');
  if (!cell || typeof openDayUpdatesModal !== 'function') return;
  openDayUpdatesModal(cell.dataset.date);
});

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
  renderDashCalendarWidget();
  renderDashboardStageBar();
  renderDashboardDealsTable();
}

// ---------- Shared interactions ----------
document.getElementById('todayView').addEventListener('click', (e) => {
  const jumpBtn = e.target.closest('[data-jump-view]');
  if (jumpBtn) { switchView(jumpBtn.dataset.jumpView); return; }

  const todoRow = e.target.closest('[data-todo-id]');
  if (todoRow) { switchView('todos'); openTodoModal(todoRow.dataset.todoId); return; }

  const debtRow = e.target.closest('[data-debt-id]');
  if (debtRow) { switchView('debts'); openDebtModal(debtRow.dataset.debtId); return; }

  const contactRow = e.target.closest('[data-contact-key]');
  if (contactRow) { switchView('contacts'); openContactUpdateModal(contactRow.dataset.contactKey, contactRow.dataset.contactName); return; }

  const row = e.target.closest('.dash-feed-row[data-id], .dash-mini-row[data-id], .dash-cal-upcoming-item[data-id]');
  if (!row) return;
  switchView('deals');
  openDetailModal(row.dataset.id);
});
