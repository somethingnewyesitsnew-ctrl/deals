/* ============================================================
   charts.js
   ------------------------------------------------------------
   The Overview tab: a KPI stat row, a rule-based Suggestions
   panel, and seven ApexCharts grouped into Sales / Marketing /
   Operations / Financial sections — all derived live from
   getDeals() (plus contact-level updates for the follow-up
   chart). Charts are (re)created each time renderCharts() runs
   rather than updated in place — the dataset is small, so this
   stays cheap and avoids stale-instance bugs when the tab was
   hidden (ApexCharts renders 0-width into display:none
   containers, so we only call this when Overview is visible —
   see app.js).

   Exposes:
     - renderCharts()
   ============================================================ */

const STAGE_ORDER = ['new', 'contacted', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_COLORS = {
  new: '#8A8886', contacted: '#0078D4', proposal: '#9D5D00',
  negotiation: '#7719AA', won: '#0F7B0F', lost: '#C42B1C',
};

let lineChartInstance = null;
let columnChartInstance = null;
let pieChartInstance = null;
let referralChartInstance = null;
let relationshipChartInstance = null;
let followupChartInstance = null;
let collectedChartInstance = null;
let revenueChartInstance = null;

function isDarkTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function chartBase() {
  const dark = isDarkTheme();
  return {
    chart: { toolbar: { show: false }, foreColor: dark ? '#C5C5C5' : '#5C5C5C', fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif" },
    grid: { borderColor: dark ? 'rgba(255,255,255,0.09)' : 'rgba(27,33,64,0.08)' },
    tooltip: { theme: dark ? 'dark' : 'light' },
  };
}

function monthKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function renderLineChart(deals) {
  const el = document.getElementById('lineChart');
  if (!el) return;

  const byMonth = new Map();
  deals.forEach(d => {
    const key = monthKey(d.createdAt);
    byMonth.set(key, (byMonth.get(key) || 0) + 1);
  });
  const keys = Array.from(byMonth.keys()).sort();
  const last = keys.slice(-9);
  const base = chartBase();

  const options = Object.assign({}, base, {
    series: [{ name: 'New deals', data: last.map(k => byMonth.get(k)) }],
    chart: Object.assign({}, base.chart, { type: 'line', height: 200 }),
    xaxis: { categories: last.map(monthLabel), labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' } }, forceNiceScale: true },
    stroke: { curve: 'smooth', width: 3.5 },
    colors: ['#0078D4'],
    fill: {
      type: 'gradient',
      gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.3, gradientToColors: ['#C239B3'], opacityFrom: 0.25, opacityTo: 0.02, stops: [0, 90, 100] },
    },
    markers: { size: 4, colors: ['#0078D4'], strokeColors: '#fff', strokeWidth: 2 },
    dataLabels: { enabled: false },
  });

  if (lineChartInstance) lineChartInstance.destroy();
  lineChartInstance = new ApexCharts(el, options);
  lineChartInstance.render();
}

function renderColumnChart(deals) {
  const el = document.getElementById('columnChart');
  if (!el) return;

  const sums = STAGE_ORDER.map(stage =>
    deals.filter(d => d.stage === stage).reduce((s, d) => s + toUSD(d.value, d.currency), 0)
  );
  const base = chartBase();

  const options = Object.assign({}, base, {
    series: [{ name: 'Value', data: sums }],
    chart: Object.assign({}, base.chart, { type: 'bar', height: 200 }),
    plotOptions: { bar: { borderRadius: 6, columnWidth: '55%', distributed: true } },
    xaxis: {
      categories: STAGE_ORDER.map(s => s.charAt(0).toUpperCase() + s.slice(1)),
      labels: { style: { colors: '#94A0B8' } },
    },
    yaxis: {
      labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) },
    },
    fill: {
      type: 'gradient',
      gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.4, opacityFrom: 1, opacityTo: 0.75, stops: [0, 100] },
    },
    colors: STAGE_ORDER.map(s => STAGE_COLORS[s]),
    legend: { show: false },
    dataLabels: { enabled: false },
  });

  if (columnChartInstance) columnChartInstance.destroy();
  columnChartInstance = new ApexCharts(el, options);
  columnChartInstance.render();
}

function renderPieChart(deals) {
  const el = document.getElementById('pieChart');
  if (!el) return;

  const types = ['government', 'private', 'international'];
  const labels = ['Government', 'Private', 'International', 'Not set'];
  const counts = types.map(t => deals.filter(d => d.entityType === t).length);
  counts.push(deals.filter(d => !d.entityType).length);
  const base = chartBase();
  const dark = isDarkTheme();

  const options = {
    series: counts,
    labels,
    chart: Object.assign({}, base.chart, { type: 'donut', height: 200 }),
    colors: ['#0078D4', '#9D5D00', '#7719AA', '#8A8886'],
    legend: { position: 'bottom', labels: { colors: dark ? '#96A0B5' : '#5B6478' } },
    dataLabels: { enabled: true, style: { colors: ['#fff'] } },
    stroke: { colors: [dark ? '#2C2C2C' : '#FFFFFF'], width: 2 },
    tooltip: { theme: dark ? 'dark' : 'light' },
  };

  if (pieChartInstance) pieChartInstance.destroy();
  pieChartInstance = new ApexCharts(el, options);
  pieChartInstance.render();
}

// ---------- Marketing: value brought in by each referral source ----------
function renderReferralChart() {
  const el = document.getElementById('referralChart');
  if (!el) return;

  const groups = (typeof buildReferralGroups === 'function' ? buildReferralGroups() : [])
    .map(g => ({ name: g.name, valueUSD: g.deals.reduce((s, d) => s + toUSD(d.value, d.currency), 0) }))
    .sort((a, b) => b.valueUSD - a.valueUSD)
    .slice(0, 8);

  const base = chartBase();
  const dark = isDarkTheme();

  if (groups.length === 0) {
    el.innerHTML = '<p class="chart-empty">No referrals logged yet.</p>';
    return;
  }
  el.innerHTML = '';

  const options = Object.assign({}, base, {
    series: [{ name: 'Value brought in', data: groups.map(g => g.valueUSD) }],
    chart: Object.assign({}, base.chart, { type: 'bar', height: 200 }),
    plotOptions: { bar: { borderRadius: 6, horizontal: true, barHeight: '55%' } },
    xaxis: { categories: groups.map(g => g.name), labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) } },
    yaxis: { labels: { style: { colors: dark ? '#C5C5C5' : '#5C5C5C' } } },
    fill: { type: 'gradient', gradient: { shade: 'light', type: 'horizontal', shadeIntensity: 0.4, opacityFrom: 1, opacityTo: 0.8, stops: [0, 100] } },
    colors: ['#7719AA'],
    dataLabels: { enabled: false },
  });

  if (referralChartInstance) referralChartInstance.destroy();
  referralChartInstance = new ApexCharts(el, options);
  referralChartInstance.render();
}

// ---------- Operations: relationship-health mix across every deal ----------
function renderRelationshipChart(deals) {
  const el = document.getElementById('relationshipChart');
  if (!el) return;

  const order = ['excellent', 'good', 'neutral', 'issues', 'bad'];
  const labels = ['Excellent', 'Good', 'Neutral', 'Had issues', 'Bad', 'Not set'];
  const counts = order.map(s => deals.filter(d => d.relationshipStatus === s).length);
  counts.push(deals.filter(d => !d.relationshipStatus).length);
  const base = chartBase();
  const dark = isDarkTheme();

  const options = {
    series: counts,
    labels,
    chart: Object.assign({}, base.chart, { type: 'donut', height: 200 }),
    colors: ['#0F7B0F', '#0078D4', '#8A8886', '#9D5D00', '#C42B1C', '#5C5C5C'],
    legend: { position: 'bottom', labels: { colors: dark ? '#96A0B5' : '#5B6478' } },
    dataLabels: { enabled: true, style: { colors: ['#fff'] } },
    stroke: { colors: [dark ? '#2C2C2C' : '#FFFFFF'], width: 2 },
    tooltip: { theme: dark ? 'dark' : 'light' },
  };

  if (relationshipChartInstance) relationshipChartInstance.destroy();
  relationshipChartInstance = new ApexCharts(el, options);
  relationshipChartInstance.render();
}

// ---------- Operations: every logged follow-up (deal + contact), by state ----------
function renderFollowupChart() {
  const el = document.getElementById('followupChart');
  if (!el) return;

  const all = [
    ...(typeof collectDealFollowUps === 'function' ? collectDealFollowUps() : []),
    ...(typeof collectContactFollowUps === 'function' ? collectContactFollowUps() : []),
  ];
  const overdue = all.filter(f => f.state === 'overdue').length;
  const soon = all.filter(f => f.state === 'soon').length;
  const later = all.filter(f => f.state === 'later').length;
  const base = chartBase();

  const options = Object.assign({}, base, {
    series: [{ name: 'Follow-ups', data: [overdue, soon, later] }],
    chart: Object.assign({}, base.chart, { type: 'bar', height: 200 }),
    plotOptions: { bar: { borderRadius: 6, columnWidth: '45%', distributed: true } },
    xaxis: { categories: ['Overdue', 'Due within 7d', 'Later'], labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' } }, forceNiceScale: true, min: 0 },
    colors: ['#C42B1C', '#9D5D00', '#0078D4'],
    legend: { show: false },
    dataLabels: { enabled: true },
  });

  if (followupChartInstance) followupChartInstance.destroy();
  followupChartInstance = new ApexCharts(el, options);
  followupChartInstance.render();
}

// ---------- Financial: how much of won value has actually been collected ----------
function renderCollectedChart(deals) {
  const el = document.getElementById('collectedChart');
  if (!el) return;

  const wonUSD = deals.filter(d => d.stage === 'won').reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  const collectedUSD = getTotalCollectedUSD();
  // "Not yet collected" deliberately spans BOTH invoiced-but-unpaid AND
  // won-but-not-yet-invoiced — a broader, sales-side view than the
  // Financial tab's "Outstanding" (which is strictly invoiced-unpaid,
  // i.e. accounts receivable). Labeled differently on purpose so the two
  // numbers are never mistaken for the same thing when they legitimately
  // don't match — see js/financial.js's computeFinancialStats().
  const uncollectedUSD = Math.max(0, wonUSD - collectedUSD);
  const base = chartBase();
  const dark = isDarkTheme();

  const options = {
    series: [collectedUSD, uncollectedUSD],
    labels: ['Collected', 'Not yet collected'],
    chart: Object.assign({}, base.chart, { type: 'donut', height: 200 }),
    colors: ['#0F7B0F', '#C42B1C'],
    legend: { position: 'bottom', labels: { colors: dark ? '#96A0B5' : '#5B6478' } },
    dataLabels: { enabled: true, formatter: (val) => Math.round(val) + '%' },
    stroke: { colors: [dark ? '#2C2C2C' : '#FFFFFF'], width: 2 },
    tooltip: { theme: dark ? 'dark' : 'light', y: { formatter: (v) => formatUSD(v) } },
  };

  if (collectedChartInstance) collectedChartInstance.destroy();
  collectedChartInstance = new ApexCharts(el, options);
  collectedChartInstance.render();
}

// ---------- Financial: paid-invoice revenue collected per month ----------
function renderRevenueChart(deals) {
  const el = document.getElementById('revenueChart');
  if (!el) return;

  const byMonth = new Map();
  deals.forEach(d => (d.invoices || []).forEach(inv => {
    if (inv.status !== 'paid' || !inv.date) return;
    const key = monthKey(new Date(inv.date).getTime());
    byMonth.set(key, (byMonth.get(key) || 0) + toUSD(invoiceTotal(inv.items), inv.currency));
  }));
  const keys = Array.from(byMonth.keys()).sort();
  const last = keys.slice(-9);
  const base = chartBase();

  const options = Object.assign({}, base, {
    series: [{ name: 'Revenue collected', data: last.map(k => Math.round(byMonth.get(k))) }],
    chart: Object.assign({}, base.chart, { type: 'area', height: 200 }),
    xaxis: { categories: last.map(monthLabel), labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) }, forceNiceScale: true },
    stroke: { curve: 'smooth', width: 3 },
    colors: ['#0F7B0F'],
    fill: { type: 'gradient', gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.3, opacityFrom: 0.35, opacityTo: 0.03, stops: [0, 100] } },
    markers: { size: 4, colors: ['#0F7B0F'], strokeColors: '#fff', strokeWidth: 2 },
    dataLabels: { enabled: false },
  });

  if (revenueChartInstance) revenueChartInstance.destroy();
  revenueChartInstance = new ApexCharts(el, options);
  revenueChartInstance.render();
}

// ---------- KPI stat row ----------
function computeOverviewStats(deals) {
  const won = deals.filter(d => d.stage === 'won');
  const lost = deals.filter(d => d.stage === 'lost');
  const open = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');

  const winRate = (won.length + lost.length) > 0 ? (won.length / (won.length + lost.length)) * 100 : null;
  const avgDealSizeUSD = deals.length ? deals.reduce((s, d) => s + toUSD(d.value, d.currency), 0) / deals.length : 0;
  const pipelineUSD = open.reduce((s, d) => s + toUSD(d.value, d.currency), 0);

  const cycleDays = won
    .filter(d => d.closeDate && d.createdAt)
    .map(d => (new Date(d.closeDate).getTime() - d.createdAt) / (24 * 60 * 60 * 1000))
    .filter(n => isFinite(n));
  const avgCycleDays = cycleDays.length ? cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length : null;

  const firstTimeShare = deals.length ? (deals.filter(d => d.firstTime === 'yes').length / deals.length) * 100 : 0;
  const referralShare = deals.length ? (deals.filter(d => d.referral && d.referral.name).length / deals.length) * 100 : 0;

  const relationshipHealthy = deals.filter(d => d.relationshipStatus === 'excellent' || d.relationshipStatus === 'good').length;
  const relationshipShare = deals.length ? (relationshipHealthy / deals.length) * 100 : 0;

  const followUps = [
    ...(typeof collectDealFollowUps === 'function' ? collectDealFollowUps() : []),
    ...(typeof collectContactFollowUps === 'function' ? collectContactFollowUps() : []),
  ];
  const followUpsDue = followUps.filter(f => f.state === 'overdue' || f.state === 'soon').length;

  const wonUSD = won.reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  const collectedUSD = getTotalCollectedUSD();
  // NOTE on the name: outstandingUSD here means "won value not yet
  // collected," which INCLUDES deals that haven't even been invoiced yet
  // — a broader, sales-side number on purpose (it's what powers the
  // Suggestions panel's "you forgot to invoice this" nudge below). The
  // Financial tab's own "Outstanding" is narrower — invoiced-but-unpaid
  // only (accounts receivable) — so the two figures can legitimately
  // differ; the property name is kept as outstandingUSD for continuity
  // with existing metric_snapshots history, but the KPI card below is
  // labeled "Uncollected" specifically so it's never mistaken for the
  // same number as Financial's "Outstanding."
  const outstandingUSD = Math.max(0, wonUSD - collectedUSD);

  return {
    winRate, avgDealSizeUSD, pipelineUSD, avgCycleDays,
    firstTimeShare, referralShare, relationshipShare, followUpsDue,
    collectedUSD, outstandingUSD, wonCount: won.length, lostCount: lost.length,
  };
}

const CATEGORY_TONE = { Sales: 'cyan', Marketing: 'violet', Operations: 'amber', Financial: 'green' };

// The exact set of metrics we snapshot daily — kept minimal and matched 1:1
// to what computeOverviewStats returns, so a delta is always comparing the
// same definition of a metric to itself, not an approximation.
const SNAPSHOT_METRIC_KEYS = ['winRate', 'avgDealSizeUSD', 'pipelineUSD', 'collectedUSD', 'outstandingUSD', 'referralShare', 'firstTimeShare', 'relationshipShare', 'followUpsDue'];

function recordTodaysSnapshotIfNeeded(deals) {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (getMetricSnapshots().some(s => s.date === todayKey)) return; // already recorded today
  const s = computeOverviewStats(deals);
  const metrics = {};
  SNAPSHOT_METRIC_KEYS.forEach(k => { metrics[k] = s[k]; });
  saveMetricSnapshot(todayKey, metrics);
}

// Returns { delta, direction } for a metric vs `daysAgo` days ago, or null if
// there's no snapshot old enough yet (never fabricated — genuinely absent).
function getMetricDelta(metricKey, currentValue, daysAgo) {
  if (currentValue === null || currentValue === undefined) return null;
  const snap = getSnapshotNDaysAgo(daysAgo || 7);
  if (!snap) return null;
  const prev = snap.metrics[metricKey];
  if (prev === null || prev === undefined) return null;
  const delta = currentValue - prev;
  return { delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
}

function deltaText(metricKey, delta) {
  if (metricKey === 'avgDealSizeUSD' || metricKey === 'pipelineUSD' || metricKey === 'collectedUSD' || metricKey === 'outstandingUSD') {
    return (delta.delta >= 0 ? '+' : '−') + formatUSD(Math.abs(delta.delta));
  }
  if (metricKey === 'followUpsDue') {
    return (delta.delta >= 0 ? '+' : '−') + Math.abs(Math.round(delta.delta));
  }
  return (delta.delta >= 0 ? '+' : '−') + Math.abs(Math.round(delta.delta)) + '%';
}

function renderOverviewStats(deals) {
  const el = document.getElementById('overviewStatsGrid');
  if (!el) return;
  const s = computeOverviewStats(deals);

  // goodDirection: 'up' means a rising number is good (shown green), 'down'
  // means a falling number is good, null means neutral (no color, just the arrow).
  const cards = [
    { cat: 'Sales', label: 'Win rate', value: s.winRate === null ? '—' : Math.round(s.winRate) + '%', raw: s.winRate, deltaKey: 'winRate', goodDirection: 'up', icon: 'bi-trophy', tone: 'green' },
    { cat: 'Sales', label: 'Avg deal size', value: formatUSD(s.avgDealSizeUSD), raw: s.avgDealSizeUSD, deltaKey: 'avgDealSizeUSD', goodDirection: 'up', icon: 'bi-graph-up-arrow', tone: 'cyan' },
    { cat: 'Sales', label: 'Avg sales cycle', value: s.avgCycleDays === null ? '—' : Math.round(s.avgCycleDays) + 'd', raw: null, deltaKey: null, icon: 'bi-stopwatch', tone: 'slate' },
    { cat: 'Marketing', label: 'First-time clients', value: Math.round(s.firstTimeShare) + '%', raw: s.firstTimeShare, deltaKey: 'firstTimeShare', goodDirection: null, icon: 'bi-person-plus', tone: 'cyan' },
    { cat: 'Marketing', label: 'Referral-sourced', value: Math.round(s.referralShare) + '%', raw: s.referralShare, deltaKey: 'referralShare', goodDirection: 'up', icon: 'bi-arrow-up-right-circle', tone: 'amber' },
    { cat: 'Operations', label: 'Relationship health', value: Math.round(s.relationshipShare) + '%', raw: s.relationshipShare, deltaKey: 'relationshipShare', goodDirection: 'up', icon: 'bi-heart', tone: 'green' },
    { cat: 'Operations', label: 'Follow-ups due', value: s.followUpsDue, raw: s.followUpsDue, deltaKey: 'followUpsDue', goodDirection: 'down', icon: 'bi-bell', tone: s.followUpsDue > 0 ? 'danger' : 'slate' },
    { cat: 'Financial', label: 'Collected', value: formatUSD(s.collectedUSD), raw: s.collectedUSD, deltaKey: 'collectedUSD', goodDirection: 'up', icon: 'bi-cash-stack', tone: 'green' },
    { cat: 'Financial', label: 'Uncollected', value: formatUSD(s.outstandingUSD), raw: s.outstandingUSD, deltaKey: 'outstandingUSD', goodDirection: 'down', icon: 'bi-exclamation-diamond', tone: s.outstandingUSD > 0.01 ? 'amber' : 'slate' },
  ];

  el.innerHTML = cards.map(c => {
    let deltaHtml = '';
    if (c.deltaKey) {
      const d = getMetricDelta(c.deltaKey, c.raw, 7);
      if (d && d.direction !== 'flat') {
        const isGood = c.goodDirection === null ? null : (d.direction === c.goodDirection);
        const deltaTone = isGood === null ? 'neutral' : (isGood ? 'good' : 'bad');
        deltaHtml = '<span class="kpi-delta kpi-delta--' + deltaTone + '">' + (d.direction === 'up' ? '▲' : '▼') + ' ' + deltaText(c.deltaKey, d) + '</span>';
      }
    }
    return '<div class="attention-stat attention-stat--' + c.tone + '">' +
      '<i class="bi ' + c.icon + '"></i>' +
      '<span class="attention-stat__figure-row"><span class="attention-stat__figure mono-figure">' + c.value + '</span>' + deltaHtml + '</span>' +
      '<span class="attention-stat__label">' + c.label + ' <span class="stat-cat-tag stat-cat-tag--' + (CATEGORY_TONE[c.cat] || 'slate') + '">' + c.cat + '</span></span>' +
    '</div>';
  }).join('');
}

// ---------- Goal tracker ----------
function renderGoalTracker() {
  const el = document.getElementById('goalTracker');
  if (!el) return;
  const goal = getRevenueGoal();
  const collectedUSD = getTotalCollectedUSD();

  if (goal <= 0) {
    el.innerHTML =
      '<div class="goal-tracker__empty">' +
        '<span><i class="bi bi-bullseye"></i> No revenue goal set yet.</span>' +
        '<div class="goal-tracker__set">' +
          '<input type="number" min="0" step="100" id="goalTrackerInput" placeholder="e.g. 50000">' +
          '<button type="button" class="btn btn-sm btn-ink" id="goalTrackerSaveBtn">Set goal</button>' +
        '</div>' +
      '</div>';
    document.getElementById('goalTrackerSaveBtn').addEventListener('click', () => {
      const val = Number(document.getElementById('goalTrackerInput').value);
      if (val > 0) { setRevenueGoal(val); renderGoalTracker(); }
    });
    return;
  }

  const pct = Math.min(100, (collectedUSD / goal) * 100);
  el.innerHTML =
    '<div class="goal-tracker__head">' +
      '<span><i class="bi bi-bullseye"></i> Revenue goal</span>' +
      '<span class="goal-tracker__figures"><strong class="mono-figure">' + formatUSD(collectedUSD) + '</strong> / ' + formatUSD(goal) + ' target <button type="button" class="goal-tracker__edit" id="goalTrackerEditBtn" title="Edit goal"><i class="bi bi-pencil"></i></button></span>' +
    '</div>' +
    '<div class="goal-tracker__bar"><div class="goal-tracker__bar-fill" style="width:' + pct + '%"></div></div>';

  document.getElementById('goalTrackerEditBtn').addEventListener('click', () => {
    const val = Number(prompt('Set revenue goal (USD):', goal));
    if (val > 0) { setRevenueGoal(val); renderGoalTracker(); }
  });
}

// ---------- Deal-of-the-week spotlight ----------
function renderSpotlight(deals) {
  const el = document.getElementById('dealSpotlight');
  if (!el) return;
  const open = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  if (open.length === 0) {
    el.innerHTML = '<p class="chart-empty">No open deals right now.</p>';
    return;
  }
  const spotlight = open.slice().sort((a, b) => toUSD(b.value, b.currency) - toUSD(a.value, a.currency))[0];
  const lastActive = timeAgo(lastActivityTimestamp(spotlight));

  el.innerHTML =
    '<h3><i class="bi bi-star-fill"></i> Deal of the week</h3>' +
    '<div class="spotlight-card__row"><span>Entity</span><strong>' + escapeHtml(spotlight.entityName || 'Untitled entity') + '</strong></div>' +
    '<div class="spotlight-card__row"><span>Value</span><strong class="mono-figure spotlight-card__value">' + formatUSD(toUSD(spotlight.value, spotlight.currency)) + '</strong></div>' +
    '<div class="spotlight-card__row"><span>Stage</span><span class="stage-badge stage-badge--' + spotlight.stage + '">' + spotlight.stage + '</span></div>' +
    (lastActive ? '<div class="spotlight-card__row"><span>Last activity</span><span>' + escapeHtml(lastActive) + '</span></div>' : '') +
    '<button type="button" class="btn btn-ink btn-sm spotlight-card__btn" id="spotlightViewBtn">View opportunity detail</button>';

  document.getElementById('spotlightViewBtn').addEventListener('click', () => openDetailModal(spotlight.id));
}

// ---------- Top clients leaderboard ----------
function renderLeaderboard(deals) {
  const el = document.getElementById('clientLeaderboard');
  if (!el) return;
  const groups = new Map();
  deals.forEach(d => {
    if (!d.entityName) return;
    const key = d.entityName.trim().toLowerCase();
    groups.set(key, (groups.get(key) || { name: d.entityName, valueUSD: 0 }));
    groups.get(key).valueUSD += toUSD(d.value, d.currency);
  });
  const top = Array.from(groups.values()).sort((a, b) => b.valueUSD - a.valueUSD).slice(0, 5);

  if (top.length === 0) {
    el.innerHTML = '<p class="chart-empty">No deals recorded yet.</p>';
    return;
  }

  el.innerHTML = top.map((c, i) =>
    '<div class="leaderboard-row">' +
      '<span class="leaderboard-row__rank">' + (i + 1) + '</span>' +
      '<span class="leaderboard-row__name">' + escapeHtml(c.name) + '</span>' +
      '<span class="leaderboard-row__value mono-figure">' + formatUSD(c.valueUSD) + '</span>' +
    '</div>'
  ).join('');
}

// ---------- Suggestions (rule-based, computed from the same data as the charts) ----------
function computeSuggestions(deals) {
  const s = computeOverviewStats(deals);
  const suggestions = [];

  const followUps = [
    ...(typeof collectDealFollowUps === 'function' ? collectDealFollowUps() : []),
    ...(typeof collectContactFollowUps === 'function' ? collectContactFollowUps() : []),
  ];
  const overdueFollowUps = followUps.filter(f => f.state === 'overdue').length;
  if (overdueFollowUps > 0) {
    suggestions.push({ icon: 'bi-alarm', tone: 'danger', cat: 'Operations',
      text: overdueFollowUps + (overdueFollowUps === 1 ? ' follow-up is' : ' follow-ups are') + ' overdue — check the Attention tab before they go cold.' });
  }

  const stalledCount = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost' && daysSince(lastActivityTimestamp(d)) >= STALE_DAYS).length;
  if (stalledCount > 0) {
    suggestions.push({ icon: 'bi-moon-stars', tone: 'slate', cat: 'Sales',
      text: stalledCount + ' open ' + (stalledCount === 1 ? 'deal has' : 'deals have') + ' had no activity in 14+ days.' });
  }

  const neverContactedCount = deals.filter(d => d.stage === 'new' && (!d.commLog || d.commLog.length === 0)).length;
  if (neverContactedCount > 0) {
    suggestions.push({ icon: 'bi-person-x', tone: 'cyan', cat: 'Sales',
      text: neverContactedCount + ' new ' + (neverContactedCount === 1 ? 'deal hasn\'t' : 'deals haven\'t') + ' been contacted yet.' });
  }

  if (s.winRate !== null && s.winRate < 30 && (s.wonCount + s.lostCount) >= 5) {
    suggestions.push({ icon: 'bi-graph-down-arrow', tone: 'amber', cat: 'Sales',
      text: 'Win rate is ' + Math.round(s.winRate) + '% — worth reviewing where proposals are losing ground.' });
  }

  if (s.outstandingUSD > 0.01) {
    suggestions.push({ icon: 'bi-cash-coin', tone: 'amber', cat: 'Financial',
      text: formatUSD(s.outstandingUSD) + ' is won but not yet collected — consider generating or following up on invoices.' });
  }

  if (deals.length >= 8 && s.referralShare < 20) {
    suggestions.push({ icon: 'bi-megaphone', tone: 'cyan', cat: 'Marketing',
      text: 'Only ' + Math.round(s.referralShare) + '% of deals are referral-sourced — a referral incentive could grow this channel.' });
  }

  if (deals.length >= 8 && s.firstTimeShare > 80) {
    suggestions.push({ icon: 'bi-people', tone: 'violet', cat: 'Marketing',
      text: Math.round(s.firstTimeShare) + '% of clients are first-time — retention outreach to past clients may be an untapped channel.' });
  }

  const badRelationships = deals.filter(d => d.relationshipStatus === 'bad' || d.relationshipStatus === 'issues').length;
  if (badRelationships > 0) {
    suggestions.push({ icon: 'bi-heartbreak', tone: 'danger', cat: 'Operations',
      text: badRelationships + ' ' + (badRelationships === 1 ? 'relationship needs' : 'relationships need') + ' attention — flagged as "had issues" or "bad".' });
  }

  if (suggestions.length === 0) {
    suggestions.push({ icon: 'bi-check-circle', tone: 'green', cat: 'All clear',
      text: 'Nothing urgent — pipeline, follow-ups, and collections all look healthy.' });
  }

  return suggestions.slice(0, 6);
}

function renderSuggestions(deals) {
  const el = document.getElementById('overviewSuggestions');
  if (!el) return;
  const suggestions = computeSuggestions(deals);

  el.innerHTML = suggestions.map(s =>
    '<div class="suggestion-card suggestion-card--' + s.tone + '">' +
      '<span class="suggestion-card__icon"><i class="bi ' + s.icon + '"></i></span>' +
      '<div class="suggestion-card__body">' +
        '<span class="suggestion-card__cat">' + s.cat + '</span>' +
        '<p>' + escapeHtml(s.text) + '</p>' +
      '</div>' +
    '</div>'
  ).join('');
}

function renderCharts() {
  const deals = getDeals();
  const emptyState = document.getElementById('overviewEmptyState');
  const content = document.getElementById('overviewContent');

  if (deals.length === 0) {
    if (emptyState) emptyState.classList.remove('d-none');
    if (content) content.classList.add('d-none');
    return;
  }
  if (emptyState) emptyState.classList.add('d-none');
  if (content) content.classList.remove('d-none');

  renderOverviewStats(deals);
  renderSuggestions(deals);
  renderGoalTracker();
  renderSpotlight(deals);
  renderLeaderboard(deals);

  renderLineChart(deals);
  renderColumnChart(deals);
  renderPieChart(deals);
  renderReferralChart();
  renderRelationshipChart(deals);
  renderFollowupChart();
  renderCollectedChart(deals);
  renderRevenueChart(deals);
}
