/* ============================================================
   today.js
   ------------------------------------------------------------
   The landing tab — internally still called "today" (ids like
   #todayView, functions like renderToday()) for historical
   reasons, but visually it's now a "Command Center" bento grid,
   deliberately a different information design from a uniform
   KPI-row: mixed cell sizes carry different weight — a real
   historical pipeline-trend chart (built from metric_snapshots,
   never a synthetic/fabricated series) gets the big 2x2 hero cell,
   a revenue-goal radial gauge gets a tall 1x2, single numbers
   get compact 1x1 tiles, attention items render as a condensed
   one-line ticker instead of a card feed, and pipeline mix is a
   donut instead of a bar.

   Nothing here is stored — everything is read live from deals,
   metric snapshots, and attention.js's unified ranked list, the
   same way every other computed view in this app works.

   Depends on: storage.js, charts.js (chartBase, isDarkTheme,
   computeOverviewStats, getMetricDelta, monthLabel), attention.js
   (buildUnifiedAttentionItems, ATTENTION_KIND_LABEL), invoices.js
   (getTotalCollectedUSD), updates.js (entryDateKey), deals-shared.js
   (isOverdue), deals-detail.js (openDetailModal), app.js (switchView).

   Exposes: renderToday(), buildTodaySections()
   ============================================================ */

const todayGreetingEl = document.getElementById('todayGreeting');
const dashDealsTableEl = document.getElementById('dashDealsTable');

function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------- "Today & upcoming" data — still used by app.js's tab badge ----------
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

// ---------- Hero cell: real open-pipeline figure + 7-day delta + trend chart ----------
let bentoTrendChartInstance = null;

function renderBentoHeroFigure() {
  const figureEl = document.getElementById('bentoHeroFigure');
  const deltaEl = document.getElementById('bentoHeroDelta');
  if (!figureEl || !deltaEl) return;

  const openDeals = getDeals().filter(d => d.stage !== 'won' && d.stage !== 'lost');
  const pipelineUSD = openDeals.reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  figureEl.textContent = formatUSD(pipelineUSD);

  const delta = typeof getMetricDelta === 'function' ? getMetricDelta('pipelineUSD', pipelineUSD, 7) : null;
  if (delta && delta.direction !== 'flat') {
    deltaEl.className = 'bento-hero__delta kpi-delta kpi-delta--' + (delta.direction === 'up' ? 'good' : 'bad');
    deltaEl.innerHTML = (delta.direction === 'up' ? '▲ ' : '▼ ') + formatUSD(Math.abs(delta.delta)) + ' vs 7 days ago';
  } else {
    deltaEl.className = 'bento-hero__delta kpi-delta kpi-delta--neutral';
    deltaEl.textContent = 'Open pipeline value';
  }
}

// A real time series from metric_snapshots (one row per day the app was
// opened) — never a fabricated/synthetic trend. Fewer points just means
// less history exists yet; nothing here invents data to fill the chart.
function renderBentoTrendChart() {
  const el = document.getElementById('bentoTrendChart');
  if (!el) return;
  const snaps = (typeof getMetricSnapshots === 'function' ? getMetricSnapshots() : []).slice(-30);

  if (snaps.length < 2) {
    el.innerHTML = '<p class="chart-empty" style="padding:1rem 0;">Trend builds up day by day — check back after the app\'s been used a bit more.</p>';
    return;
  }

  const base = chartBase();
  const dark = isDarkTheme();
  const options = Object.assign({}, base, {
    series: [
      { name: 'Pipeline', data: snaps.map(s => Math.round(s.metrics.pipelineUSD || 0)) },
      { name: 'Collected', data: snaps.map(s => Math.round(s.metrics.collectedUSD || 0)) },
    ],
    chart: Object.assign({}, base.chart, { type: 'area', height: '100%' }),
    xaxis: { categories: snaps.map(s => new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })), labels: { style: { colors: '#94A0B8' }, rotate: 0 }, tickAmount: Math.min(6, snaps.length - 1) },
    yaxis: { labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) } },
    stroke: { curve: 'smooth', width: 2.5 },
    colors: [dark ? '#38BDF8' : '#0F172A', '#10B981'],
    fill: { type: 'gradient', gradient: { shadeIntensity: 0.3, opacityFrom: 0.35, opacityTo: 0.03 } },
    legend: { show: true, position: 'top', horizontalAlign: 'right', fontSize: '11px', labels: { colors: dark ? '#96A0B5' : '#5B6478' }, markers: { size: 5 } },
    dataLabels: { enabled: false },
    grid: Object.assign({}, base.grid, { padding: { left: 8, right: 8 } }),
  });

  if (bentoTrendChartInstance) bentoTrendChartInstance.destroy();
  bentoTrendChartInstance = new ApexCharts(el, options);
  bentoTrendChartInstance.render();
}

// ---------- Revenue Goal radial gauge ----------
let bentoGoalChartInstance = null;

function renderBentoGoalRadial() {
  const el = document.getElementById('bentoGoalRadial');
  const figuresEl = document.getElementById('bentoGoalFigures');
  if (!el || !figuresEl) return;

  const goal = typeof getRevenueGoal === 'function' ? getRevenueGoal() : 0;
  const collected = typeof getTotalCollectedUSD === 'function' ? getTotalCollectedUSD() : 0;

  if (goal <= 0) {
    el.innerHTML = '';
    figuresEl.innerHTML = '<button type="button" class="link-btn" id="bentoSetGoalBtn">Set a revenue goal →</button>';
    document.getElementById('bentoSetGoalBtn').addEventListener('click', () => {
      const val = Number(prompt('Set revenue goal (USD):'));
      if (val > 0) { setRevenueGoal(val); renderBentoGoalRadial(); }
    });
    return;
  }

  const pct = Math.min(100, Math.round((collected / goal) * 100));
  const base = chartBase();
  const dark = isDarkTheme();
  const options = {
    series: [pct],
    chart: Object.assign({}, base.chart, { type: 'radialBar', height: 150 }),
    plotOptions: { radialBar: { hollow: { size: '62%' }, track: { background: dark ? 'rgba(255,255,255,0.08)' : 'var(--slate-soft)' }, dataLabels: { name: { show: false }, value: { fontSize: '22px', fontWeight: 700, color: dark ? '#F1F5F9' : '#0F172A', formatter: (v) => v + '%' } } } },
    colors: [dark ? '#38BDF8' : '#0F172A'],
  };

  if (bentoGoalChartInstance) bentoGoalChartInstance.destroy();
  bentoGoalChartInstance = new ApexCharts(el, options);
  bentoGoalChartInstance.render();

  figuresEl.innerHTML = '<span class="bento-goal__collected">' + formatUSD(collected) + '</span><span class="bento-goal__of">of ' + formatUSD(goal) + ' goal</span>';
}

// ---------- Compact single-figure tiles ----------
function renderBentoSmallStats() {
  const deals = getDeals();
  const s = typeof computeOverviewStats === 'function' ? computeOverviewStats(deals) : {};

  const winRateEl = document.getElementById('bentoWinRateFigure');
  const winRateSubEl = document.getElementById('bentoWinRateSub');
  if (winRateEl) winRateEl.textContent = (s.winRate === null || s.winRate === undefined) ? '—' : Math.round(s.winRate) + '%';
  if (winRateSubEl) winRateSubEl.textContent = (s.wonCount || 0) + ' won · ' + (s.lostCount || 0) + ' lost';

  const avgEl = document.getElementById('bentoAvgDealFigure');
  const avgSubEl = document.getElementById('bentoAvgDealSub');
  if (avgEl) avgEl.textContent = formatUSD(s.avgDealSizeUSD || 0);
  if (avgSubEl) avgSubEl.textContent = deals.length + ' deal' + (deals.length === 1 ? '' : 's') + ' total';
}

// ---------- Needs Attention ticker — condensed, one line per item ----------
function bentoTickerRow(item) {
  const idAttr = item.kind === 'deal' ? 'data-id="' + item.id + '"'
    : item.kind === 'todo' ? 'data-todo-id="' + item.id + '"'
    : item.kind === 'debt' ? 'data-debt-id="' + item.id + '"'
    : 'data-contact-key="' + escapeHtml(item.contactKey) + '" data-contact-name="' + escapeHtml(item.contactName) + '"';
  return '' +
    '<button type="button" class="bento-ticker__row" ' + idAttr + '>' +
      '<span class="bento-ticker__dot bento-ticker__dot--' + item.tone + '"></span>' +
      '<span class="bento-ticker__name">' + escapeHtml(item.name) + '</span>' +
      '<span class="bento-ticker__reason">' + escapeHtml(item.reason) + '</span>' +
      '<span class="bento-ticker__detail">' + escapeHtml(item.detail) + '</span>' +
      '<i class="bi bi-chevron-right bento-ticker__chevron"></i>' +
    '</button>';
}

function renderBentoTicker() {
  const el = document.getElementById('bentoTicker');
  if (!el) return;
  const items = typeof buildUnifiedAttentionItems === 'function' ? buildUnifiedAttentionItems().slice(0, 5) : [];
  el.innerHTML = items.length
    ? items.map(bentoTickerRow).join('')
    : '<p class="attention-clear"><i class="bi bi-check-lg"></i>All clear</p>';
}

// ---------- Pipeline by Stage — donut instead of a bar ----------
let bentoStageDonutInstance = null;

function renderBentoStageDonut() {
  const el = document.getElementById('bentoStageDonut');
  if (!el) return;
  const openDeals = getDeals().filter(d => d.stage !== 'won' && d.stage !== 'lost');

  if (openDeals.length === 0) {
    el.innerHTML = '<p class="chart-empty" style="padding:1rem 0;">No open deals right now.</p>';
    return;
  }

  const order = ['new', 'contacted', 'proposal', 'negotiation'];
  const labels = ['New', 'Contacted', 'Proposal', 'Negotiation'];
  const counts = order.map(s => openDeals.filter(d => d.stage === s).length);
  const base = chartBase();
  const dark = isDarkTheme();

  const options = {
    series: counts,
    labels,
    chart: Object.assign({}, base.chart, { type: 'donut', height: '100%' }),
    colors: ['#8A8886', '#0369A1', '#B45309', '#7C3AED'],
    legend: { position: 'right', fontSize: '11px', labels: { colors: dark ? '#96A0B5' : '#5B6478' } },
    dataLabels: { enabled: false },
    stroke: { colors: [dark ? '#161E2E' : '#FFFFFF'], width: 2 },
    plotOptions: { pie: { donut: { labels: { show: true, total: { show: true, label: 'Open deals', formatter: () => String(openDeals.length) } } } } },
  };

  if (bentoStageDonutInstance) bentoStageDonutInstance.destroy();
  bentoStageDonutInstance = new ApexCharts(el, options);
  bentoStageDonutInstance.render();
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

  renderBentoHeroFigure();
  renderBentoTrendChart();
  renderBentoGoalRadial();
  renderBentoSmallStats();
  renderBentoTicker();
  renderBentoStageDonut();
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

  const row = e.target.closest('.bento-ticker__row[data-id], .dash-mini-row[data-id]');
  if (!row) return;
  switchView('deals');
  openDetailModal(row.dataset.id);
});
