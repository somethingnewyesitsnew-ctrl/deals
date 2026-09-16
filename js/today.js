/* ============================================================
   today.js
   ------------------------------------------------------------
   The landing tab — internally still called "today" (ids like
   #todayView, functions like renderToday()) for historical/
   load-order reasons, but visually it's now "Executive Overview":
   a dark corporate summary band (greeting, an attention pill, and
   4 KPI tiles — each with an honest week-over-week delta pulled
   from real metric_snapshots history, never fabricated), a real
   revenue-collected trend chart paired with a revenue-goal
   progress ring, and a three-card strip: Priority Actions (the
   same unified, ranked attention feed the Attention tab itself
   uses), Pipeline by Stage, and Recent Wins.

   Nothing here is stored — everything is read live from deals,
   invoices, metric snapshots, and attention.js's unified ranked
   list, the same way every other computed view in this app works.

   Depends on: storage.js, charts.js (chartBase, isDarkTheme,
   monthKey, monthLabel, computeOverviewStats, getMetricDelta,
   deltaText), invoices.js (invoiceTotal, getTotalCollectedUSD),
   attention.js (buildUnifiedAttentionItems, getAttentionCounts),
   updates.js (entryDateKey), deals-shared.js, deals-detail.js
   (openDetailModal), app.js (switchView).

   Exposes: renderToday(), buildTodaySections()
   ============================================================ */

function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------- "Today" data — still used by app.js's sidebar tab badge ----------
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

// ---------- 1. Hero band: greeting, attention pill, KPI tiles ----------
const CC_KPI_DEFS = [
  { key: 'pipelineUSD', label: 'Open pipeline', icon: 'bi-graph-up-arrow', good: 'up', fmt: (v) => formatUSD(v) },
  { key: 'collectedUSD', label: 'Collected', icon: 'bi-cash-stack', good: 'up', fmt: (v) => formatUSD(v) },
  { key: 'winRate', label: 'Win rate', icon: 'bi-trophy', good: 'up', fmt: (v) => (v === null || v === undefined) ? '—' : Math.round(v) + '%' },
  { key: 'outstandingUSD', label: 'Uncollected', icon: 'bi-hourglass-split', good: 'down', fmt: (v) => formatUSD(v) },
];

function renderCCKpis(deals) {
  const rowEl = document.getElementById('ccKpiRow');
  if (!rowEl) return;
  const s = typeof computeOverviewStats === 'function' ? computeOverviewStats(deals) : {};

  rowEl.innerHTML = CC_KPI_DEFS.map(c => {
    const raw = s[c.key];
    let deltaHtml = '';
    const delta = typeof getMetricDelta === 'function' ? getMetricDelta(c.key, raw, 7) : null;
    if (delta && delta.direction !== 'flat') {
      const isGood = delta.direction === c.good;
      deltaHtml = '<span class="cc-kpi__delta cc-kpi__delta--' + (isGood ? 'good' : 'bad') + '">' +
        (delta.direction === 'up' ? '▲' : '▼') + ' ' + deltaText(c.key, delta) + '</span>';
    }
    return '' +
      '<div class="cc-kpi">' +
        '<span class="cc-kpi__label"><i class="bi ' + c.icon + '"></i>' + c.label + '</span>' +
        '<div class="cc-kpi__value-row"><span class="cc-kpi__value">' + c.fmt(raw) + '</span>' + deltaHtml + '</div>' +
      '</div>';
  }).join('');
}

function renderCCHero(deals) {
  const dateEl = document.getElementById('ccDateLabel');
  const greetEl = document.getElementById('todayGreeting');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (greetEl) greetEl.textContent = greetingWord();

  const pillEl = document.getElementById('ccAttentionPill');
  if (pillEl) {
    const count = typeof getAttentionCounts === 'function' ? getAttentionCounts() : 0;
    pillEl.className = 'cc-hero__pill ' + (count > 0 ? 'cc-hero__pill--danger' : 'cc-hero__pill--clear');
    pillEl.innerHTML = count > 0
      ? '<i class="bi bi-exclamation-triangle-fill"></i>' + count + (count === 1 ? ' item needs attention' : ' items need attention')
      : '<i class="bi bi-check-circle-fill"></i>All caught up';
  }

  renderCCKpis(deals);
}

// ---------- 2a. Revenue collected trend ----------
let ccRevenueChartInstance = null;
let ccDealsLineChartInstance = null;
let ccEntityMixChartInstance = null;
let ccFollowupChartInstance = null;

function renderCCRevenueChart(deals) {
  const el = document.getElementById('ccRevenueChart');
  if (!el) return;

  const byMonth = new Map();
  deals.forEach(d => (d.invoices || []).forEach(inv => {
    if (inv.status !== 'paid' || !inv.date) return;
    const key = monthKey(new Date(inv.date).getTime());
    byMonth.set(key, (byMonth.get(key) || 0) + toUSD(invoiceTotal(inv.items), inv.currency));
  }));
  const keys = Array.from(byMonth.keys()).sort();
  const last = keys.slice(-6);

  if (last.length === 0) {
    el.innerHTML = '<p class="cc-empty-note">No paid invoices yet — collected revenue will chart here once invoices are marked paid.</p>';
    return;
  }
  el.innerHTML = '';

  const base = chartBase();
  const dark = isDarkTheme();
  const lineColor = dark ? '#4CC2FF' : '#0F6CBD';

  const options = Object.assign({}, base, {
    series: [{ name: 'Revenue collected', data: last.map(k => Math.round(byMonth.get(k) || 0)) }],
    chart: Object.assign({}, base.chart, { type: 'area', height: 250 }),
    xaxis: { categories: last.map(monthLabel), labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) }, forceNiceScale: true },
    stroke: { curve: 'smooth', width: 3 },
    colors: [lineColor],
    fill: { type: 'gradient', gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.35, opacityFrom: 0.4, opacityTo: 0.04, stops: [0, 100] } },
    markers: { size: 4, colors: [lineColor], strokeColors: dark ? '#2A2A2A' : '#fff', strokeWidth: 2 },
    dataLabels: { enabled: false },
    tooltip: Object.assign({}, base.tooltip, { y: { formatter: (v) => formatUSD(v) } }),
  });

  if (ccRevenueChartInstance) ccRevenueChartInstance.destroy();
  ccRevenueChartInstance = new ApexCharts(el, options);
  ccRevenueChartInstance.render();
}

// ---------- 2b. Revenue goal progress ring ----------
function renderCCGoal() {
  const bodyEl = document.getElementById('ccGoalBody');
  if (!bodyEl) return;

  const goal = typeof getRevenueGoal === 'function' ? getRevenueGoal() : 0;
  const collected = typeof getTotalCollectedUSD === 'function' ? getTotalCollectedUSD() : 0;

  if (goal <= 0) {
    bodyEl.innerHTML = '' +
      '<div class="cc-goal-empty">' +
        '<i class="bi bi-bullseye"></i>' +
        '<p style="margin:0;font-size:0.82rem;">No revenue goal set yet.</p>' +
        '<div class="cc-goal-empty__row">' +
          '<input type="number" min="0" step="100" id="ccGoalInput" placeholder="e.g. 50000">' +
          '<button type="button" class="btn btn-sm btn-ink" id="ccGoalSaveBtn">Set goal</button>' +
        '</div>' +
      '</div>';
    document.getElementById('ccGoalSaveBtn').addEventListener('click', () => {
      const val = Number(document.getElementById('ccGoalInput').value);
      if (val > 0) { setRevenueGoal(val); renderCCGoal(); }
    });
    return;
  }

  const pct = Math.min(100, Math.round((collected / goal) * 100));
  bodyEl.innerHTML = '' +
    '<div class="cc-goal-ring" style="--pct:' + pct + '">' +
      '<div class="cc-goal-ring__inner"><span class="cc-goal-ring__pct">' + pct + '%</span><span class="cc-goal-ring__label">of goal</span></div>' +
    '</div>' +
    '<div class="cc-goal-figures"><strong>' + formatUSD(collected) + '</strong> collected<br>of <strong>' + formatUSD(goal) + '</strong> target</div>' +
    '<button type="button" class="link-btn cc-goal-edit" id="ccGoalEditBtn">Edit goal</button>';

  document.getElementById('ccGoalEditBtn').addEventListener('click', () => {
    const val = Number(prompt('Set revenue goal (USD):', goal));
    if (val > 0) { setRevenueGoal(val); renderCCGoal(); }
  });
}

// ---------- 2c. Deals momentum (new deals created per month) ----------
function renderCCDealsLineChart(deals) {
  const el = document.getElementById('ccDealsLineChart');
  if (!el) return;

  if (deals.length === 0) {
    el.innerHTML = '<p class="cc-empty-note">Record a deal to see this chart.</p>';
    return;
  }
  el.innerHTML = '';

  const byMonth = new Map();
  deals.forEach(d => {
    const key = monthKey(d.createdAt);
    byMonth.set(key, (byMonth.get(key) || 0) + 1);
  });
  const keys = Array.from(byMonth.keys()).sort();
  const last = keys.slice(-9);

  const base = chartBase();
  const dark = isDarkTheme();
  const lineColor = dark ? '#C29CFF' : '#7719AA';

  const options = Object.assign({}, base, {
    series: [{ name: 'New deals', data: last.map(k => byMonth.get(k) || 0) }],
    chart: Object.assign({}, base.chart, { type: 'line', height: 230 }),
    xaxis: { categories: last.map(monthLabel), labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' } }, forceNiceScale: true, min: 0 },
    stroke: { curve: 'smooth', width: 3 },
    colors: [lineColor],
    fill: { type: 'gradient', gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.3, opacityFrom: 0.3, opacityTo: 0.03, stops: [0, 100] } },
    markers: { size: 4, colors: [lineColor], strokeColors: dark ? '#2A2A2A' : '#fff', strokeWidth: 2 },
    dataLabels: { enabled: false },
  });

  if (ccDealsLineChartInstance) ccDealsLineChartInstance.destroy();
  ccDealsLineChartInstance = new ApexCharts(el, options);
  ccDealsLineChartInstance.render();
}

// ---------- 2d. Client mix (entity type donut) ----------
function renderCCEntityMixChart(deals) {
  const el = document.getElementById('ccEntityMixChart');
  if (!el) return;

  if (deals.length === 0) {
    el.innerHTML = '<p class="cc-empty-note">No deals recorded yet.</p>';
    return;
  }
  el.innerHTML = '';

  const types = ['government', 'private', 'international'];
  const labels = ['Government', 'Private', 'International', 'Not set'];
  const counts = types.map(t => deals.filter(d => d.entityType === t).length);
  counts.push(deals.filter(d => !d.entityType).length);

  const base = chartBase();
  const dark = isDarkTheme();

  const options = {
    series: counts,
    labels,
    chart: Object.assign({}, base.chart, { type: 'donut', height: 230 }),
    colors: ['#0F6CBD', '#9D5D00', '#7719AA', '#8A8886'],
    legend: { position: 'bottom', fontSize: '11px', labels: { colors: dark ? '#96A0B5' : '#5B6478' } },
    dataLabels: { enabled: true, style: { colors: ['#fff'] } },
    stroke: { colors: [dark ? '#2A2A2A' : '#FFFFFF'], width: 2 },
    tooltip: { theme: dark ? 'dark' : 'light' },
  };

  if (ccEntityMixChartInstance) ccEntityMixChartInstance.destroy();
  ccEntityMixChartInstance = new ApexCharts(el, options);
  ccEntityMixChartInstance.render();
}

// ---------- 3a. Priority actions — reuses attention.js's unified ranked list ----------
function ccPriorityRow(item) {
  const idAttr = item.kind === 'deal' ? 'data-id="' + item.id + '"'
    : item.kind === 'todo' ? 'data-todo-id="' + item.id + '"'
    : item.kind === 'debt' ? 'data-debt-id="' + item.id + '"'
    : 'data-contact-key="' + escapeHtml(item.contactKey) + '" data-contact-name="' + escapeHtml(item.contactName) + '"';

  return '' +
    '<button type="button" class="attention-row" ' + idAttr + '>' +
      '<span class="attention-row__name" title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>' +
      '<span class="attention-row__context attention-row__context--' + item.tone + '">' + escapeHtml(item.reason) + '</span>' +
      '<span class="attention-row__note">' + escapeHtml(item.detail) + '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function renderCCPriorityList() {
  const el = document.getElementById('ccPriorityList');
  if (!el) return;
  const items = typeof buildUnifiedAttentionItems === 'function' ? buildUnifiedAttentionItems().slice(0, 6) : [];
  el.innerHTML = items.length
    ? items.map(ccPriorityRow).join('')
    : '<p class="attention-clear"><i class="bi bi-check-lg"></i>Nothing needs attention right now</p>';
}

// ---------- 3b. Pipeline by stage ----------
const CC_STAGE_ORDER = ['new', 'contacted', 'proposal', 'negotiation'];
const CC_STAGE_LABELS = { new: 'New', contacted: 'Contacted', proposal: 'Proposal', negotiation: 'Negotiation' };
const CC_STAGE_COLOR_VARS = { new: 'var(--text-faint)', contacted: 'var(--cyan)', proposal: 'var(--amber)', negotiation: 'var(--violet)' };

function renderCCStageBars(deals) {
  const el = document.getElementById('ccStageBars');
  if (!el) return;
  const open = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');

  if (open.length === 0) {
    el.innerHTML = '<p class="cc-empty-note">No open deals right now.</p>';
    return;
  }

  const sums = CC_STAGE_ORDER.map(s => open.filter(d => d.stage === s).reduce((sum, d) => sum + toUSD(d.value, d.currency), 0));
  const counts = CC_STAGE_ORDER.map(s => open.filter(d => d.stage === s).length);
  const max = Math.max(...sums, 1);

  el.innerHTML = CC_STAGE_ORDER.map((stage, i) => '' +
    '<div class="cc-stage-bar">' +
      '<span class="cc-stage-bar__label">' + CC_STAGE_LABELS[stage] + '</span>' +
      '<span class="cc-stage-bar__track"><span class="cc-stage-bar__fill" style="width:' + Math.max(4, (sums[i] / max) * 100) + '%;background:' + CC_STAGE_COLOR_VARS[stage] + '"></span></span>' +
      '<span class="cc-stage-bar__value">' + formatUSD(sums[i]) + ' · ' + counts[i] + '</span>' +
    '</div>'
  ).join('');
}

// ---------- 3c. Recent wins ----------
function ccWinRow(deal) {
  return '' +
    '<button type="button" class="attention-row" data-id="' + deal.id + '">' +
      '<span class="attention-row__name" title="' + escapeHtml(deal.entityName || 'Untitled entity') + '">' + escapeHtml(deal.entityName || 'Untitled entity') + '</span>' +
      '<span class="attention-row__note">' + formatUSD(toUSD(deal.value, deal.currency)) + '</span>' +
      '<span class="attention-row__context">' + escapeHtml(timeAgo(deal.updatedAt) || '') + '</span>' +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>';
}

function renderCCRecentWins(deals) {
  const el = document.getElementById('ccRecentWins');
  if (!el) return;
  const wins = deals.filter(d => d.stage === 'won').slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  el.innerHTML = wins.length ? wins.map(ccWinRow).join('') : '<p class="cc-empty-note">No wins recorded yet — they\'ll show up here the moment a deal moves to Won.</p>';
}

// ---------- 4a. Smart suggestions — reuses charts.js's rule-based engine ----------
function renderCCSuggestions(deals) {
  const el = document.getElementById('ccSuggestions');
  if (!el) return;
  const suggestions = typeof computeSuggestions === 'function' ? computeSuggestions(deals) : [];
  el.innerHTML = suggestions.map(s => '' +
    '<div class="suggestion-card suggestion-card--' + s.tone + '">' +
      '<span class="suggestion-card__icon"><i class="bi ' + s.icon + '"></i></span>' +
      '<div class="suggestion-card__body">' +
        '<span class="suggestion-card__cat">' + s.cat + '</span>' +
        '<p>' + escapeHtml(s.text) + '</p>' +
      '</div>' +
    '</div>'
  ).join('');
}

// ---------- 4b. Top clients leaderboard (clickable — jumps into Deals, filtered) ----------
function renderCCLeaderboard(deals) {
  const el = document.getElementById('ccLeaderboard');
  if (!el) return;

  const groups = new Map();
  deals.forEach(d => {
    if (!d.entityName) return;
    const key = d.entityName.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: d.entityName, valueUSD: 0 });
    groups.get(key).valueUSD += toUSD(d.value, d.currency);
  });
  const top = Array.from(groups.values()).sort((a, b) => b.valueUSD - a.valueUSD).slice(0, 5);

  const header = '<h3><i class="bi bi-trophy"></i> Top clients</h3>';
  el.innerHTML = header + (top.length
    ? top.map((c, i) => '' +
        '<button type="button" class="leaderboard-row cc-leaderboard-row" data-jump-entity="' + escapeHtml(c.name) + '">' +
          '<span class="leaderboard-row__rank">' + (i + 1) + '</span>' +
          '<span class="leaderboard-row__name">' + escapeHtml(c.name) + '</span>' +
          '<span class="leaderboard-row__value">' + formatUSD(c.valueUSD) + '</span>' +
        '</button>'
      ).join('')
    : '<p class="cc-empty-note">No deals recorded yet.</p>');
}

// ---------- 4c. Deal spotlight (highest-value open opportunity) ----------
function renderCCSpotlight(deals) {
  const el = document.getElementById('ccSpotlight');
  if (!el) return;

  const open = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  if (open.length === 0) {
    el.innerHTML = '<h3><i class="bi bi-star-fill"></i> Deal spotlight</h3><p class="cc-empty-note">No open deals right now.</p>';
    return;
  }

  const spotlight = open.slice().sort((a, b) => toUSD(b.value, b.currency) - toUSD(a.value, a.currency))[0];
  const lastActive = timeAgo(lastActivityTimestamp(spotlight));

  el.innerHTML = '' +
    '<h3><i class="bi bi-star-fill"></i> Deal spotlight</h3>' +
    '<div class="spotlight-card__row"><span>Entity</span><strong>' + escapeHtml(spotlight.entityName || 'Untitled entity') + '</strong></div>' +
    '<div class="spotlight-card__row"><span>Value</span><strong class="mono-figure spotlight-card__value">' + formatUSD(toUSD(spotlight.value, spotlight.currency)) + '</strong></div>' +
    '<div class="spotlight-card__row"><span>Stage</span><span class="stage-badge stage-badge--' + spotlight.stage + '">' + spotlight.stage + '</span></div>' +
    (lastActive ? '<div class="spotlight-card__row"><span>Last activity</span><span>' + escapeHtml(lastActive) + '</span></div>' : '') +
    '<button type="button" class="btn btn-ink btn-sm spotlight-card__btn" id="ccSpotlightViewBtn">View opportunity detail</button>';

  document.getElementById('ccSpotlightViewBtn').addEventListener('click', () => openDetailModal(spotlight.id));
}

// ---------- 4d. Follow-ups status (deals + contacts, by urgency) ----------
function renderCCFollowupChart() {
  const el = document.getElementById('ccFollowupChart');
  if (!el) return;

  const all = [
    ...(typeof collectDealFollowUps === 'function' ? collectDealFollowUps() : []),
    ...(typeof collectContactFollowUps === 'function' ? collectContactFollowUps() : []),
  ];
  const overdue = all.filter(f => f.state === 'overdue').length;
  const soon = all.filter(f => f.state === 'soon').length;
  const later = all.filter(f => f.state === 'later').length;

  if (overdue + soon + later === 0) {
    el.innerHTML = '<p class="cc-empty-note">No follow-ups with a next-step date logged yet.</p>';
    return;
  }
  el.innerHTML = '';

  const base = chartBase();
  const options = Object.assign({}, base, {
    series: [{ name: 'Follow-ups', data: [overdue, soon, later] }],
    chart: Object.assign({}, base.chart, { type: 'bar', height: 230 }),
    plotOptions: { bar: { borderRadius: 6, columnWidth: '45%', distributed: true } },
    xaxis: { categories: ['Overdue', 'Due within 7d', 'Later'], labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' } }, forceNiceScale: true, min: 0 },
    colors: ['#C42B1C', '#9D5D00', '#0F6CBD'],
    legend: { show: false },
    dataLabels: { enabled: true },
  });

  if (ccFollowupChartInstance) ccFollowupChartInstance.destroy();
  ccFollowupChartInstance = new ApexCharts(el, options);
  ccFollowupChartInstance.render();
}

// ---------- 4e. Projects — work progress + money, per project ----------
function ccProjectMoney(project) {
  if (project.dealId) {
    const deal = getDeals().find(d => d.id === project.dealId);
    if (!deal) return { tone: 'slate', text: 'Linked deal not found' };
    const status = dealPaymentStatus(deal);
    const valueUSD = toUSD(deal.value, deal.currency);
    return {
      tone: status.tone,
      text: formatUSD(valueUSD) + ' · ' + status.label + (status.remainingUSD > 0.01 ? ' (' + formatUSD(status.remainingUSD) + ' left)' : ''),
    };
  }
  const linked = (typeof getExpenses === 'function' ? getExpenses() : []).filter(e => (e.links || []).some(l => l.type === 'project' && l.id === project.id));
  if (linked.length === 0) return { tone: 'slate', text: 'No money linked yet' };
  const incomeUSD = linked.filter(e => e.kind === 'income').reduce((s, e) => s + toUSD(e.amount, e.currency), 0);
  const expenseUSD = linked.filter(e => e.kind !== 'income').reduce((s, e) => s + toUSD(e.amount, e.currency), 0);
  return { tone: (incomeUSD - expenseUSD) >= 0 ? 'green' : 'danger', text: formatUSD(incomeUSD) + ' in · ' + formatUSD(expenseUSD) + ' out' };
}

function ccProjectCard(project) {
  const typeMeta = PROJECT_TYPE_META[project.type] || PROJECT_TYPE_META.other;
  const progress = projectPhaseProgress(project);
  const deal = project.dealId ? getDeals().find(d => d.id === project.dealId) : null;
  const clientLabel = deal ? (deal.entityName || 'Untitled entity') : project.clientName;
  const money = ccProjectMoney(project);

  return '' +
    '<button type="button" class="project-card" data-open-project="' + project.id + '">' +
      '<div class="project-card__head">' +
        '<span class="project-card__type"><i class="bi ' + typeMeta.icon + '"></i>' + typeMeta.label + '</span>' +
        '<span class="dev-status-badge dev-status-badge--' + WORK_STATUS_TONE[project.status] + '">' + WORK_STATUS_LABELS[project.status] + '</span>' +
      '</div>' +
      '<div class="project-card__name">' + escapeHtml(project.name) + '</div>' +
      (clientLabel ? '<div class="project-card__client"><i class="bi ' + (deal ? 'bi-journal-text' : 'bi-building') + '"></i>' + escapeHtml(clientLabel) + '</div>' : '') +
      (progress.total
        ? '<div class="project-card__progress"><div class="project-card__progress-bar"><span style="width:' + progress.pct + '%"></span></div><span class="project-card__progress-label">' + progress.done + '/' + progress.total + ' phases</span></div>'
        : '<p class="no-referral mb-0">No phases set yet.</p>') +
      '<div class="cc-project-card__money cc-project-card__money--' + money.tone + '"><i class="bi bi-cash-coin"></i>' + escapeHtml(money.text) + '</div>' +
    '</button>';
}

function renderCCProjects() {
  const statsEl = document.getElementById('ccProjectStats');
  const gridEl = document.getElementById('ccProjectGrid');
  if (!statsEl || !gridEl) return;

  const projects = typeof getProjects === 'function' ? getProjects() : [];
  if (projects.length === 0) {
    statsEl.innerHTML = '';
    gridEl.innerHTML = '<p class="cc-empty-note">No projects yet — convert a Won deal into one, or start a new project from the + button.</p>';
    return;
  }

  const active = projects.filter(p => p.status !== 'delivered' && p.status !== 'completed');
  const delivered = projects.filter(p => p.status === 'delivered' || p.status === 'completed');

  let valueUSD = 0, collectedUSD = 0;
  projects.forEach(p => {
    if (!p.dealId) return;
    const deal = getDeals().find(d => d.id === p.dealId);
    if (!deal) return;
    valueUSD += toUSD(deal.value, deal.currency);
    collectedUSD += dealPaymentStatus(deal).paidUSD;
  });

  const withPhases = projects.filter(p => (p.phases || []).length > 0);
  const avgPct = withPhases.length ? Math.round(withPhases.reduce((sum, p) => sum + projectPhaseProgress(p).pct, 0) / withPhases.length) : null;

  statsEl.innerHTML = [
    ['Active projects', active.length, 'bi-kanban', 'cyan'],
    ['Delivered', delivered.length, 'bi-check-circle', 'green'],
    ['Avg. completion', avgPct === null ? '—' : avgPct + '%', 'bi-speedometer2', 'amber'],
    ['Project value', formatUSD(valueUSD), 'bi-cash-stack', 'slate'],
    ['Collected', formatUSD(collectedUSD), 'bi-cash-coin', 'green'],
  ].map(([label, value, icon, tone]) =>
    '<div class="attention-stat attention-stat--' + tone + '">' +
      '<i class="bi ' + icon + '"></i>' +
      '<span class="attention-stat__figure">' + value + '</span>' +
      '<span class="attention-stat__label">' + label + '</span>' +
    '</div>'
  ).join('');

  const pool = active.length ? active : projects;
  const shown = pool.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  gridEl.innerHTML = shown.map(ccProjectCard).join('');
}

// ---------- Orchestration ----------
function renderToday() {
  const deals = getDeals();
  renderCCHero(deals);
  renderCCRevenueChart(deals);
  renderCCGoal();
  renderCCDealsLineChart(deals);
  renderCCEntityMixChart(deals);
  renderCCPriorityList();
  renderCCStageBars(deals);
  renderCCRecentWins(deals);
  renderCCSuggestions(deals);
  renderCCProjects();
  renderCCLeaderboard(deals);
  renderCCSpotlight(deals);
  renderCCFollowupChart();
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

  const entityRow = e.target.closest('[data-jump-entity]');
  if (entityRow) { switchView('deals', { searchTerm: entityRow.dataset.jumpEntity }); return; }

  const projectCard = e.target.closest('[data-open-project]');
  if (projectCard) { switchView('projects'); openProjectModal(projectCard.dataset.openProject); return; }

  const row = e.target.closest('.attention-row[data-id]');
  if (!row) return;
  switchView('deals');
  openDetailModal(row.dataset.id);
});
