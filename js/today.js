/* ============================================================
   today.js
   ------------------------------------------------------------
   The landing tab — internally still called "today" (ids like
   #todayView, functions like renderToday()) for historical/
   load-order reasons, but the design is now "The Cockpit," built
   from scratch around one question: what should I do in the next
   5 minutes to make or protect money? Everything is ordered by
   financial impact, not by data category. See the header comment
   on #todayView in index.html for the full layer-by-layer why.

   Nothing here is stored — everything is read live from deals,
   invoices, projects, and attention.js's unified ranked list, the
   same way every other computed view in this app works. Every
   delta shown is either pulled from real metric_snapshots history
   or computed directly from two real calendar periods — never
   invented.

   Depends on: storage.js, charts.js (chartBase, isDarkTheme,
   monthKey, monthLabel, computeOverviewStats, getMetricDelta,
   deltaText), invoices.js (invoiceTotal, formatInvoiceAmount,
   getTotalCollectedUSD), financial.js (getAllInvoicesFlat,
   daysUntilDateStr, buildReminderLink), attention.js
   (buildUnifiedAttentionItems, getAttentionCounts,
   attentionPriorityCard), projects.js (getProjects,
   PROJECT_TYPE_META, projectPhaseProgress), deals-shared.js,
   deals-detail.js (openDetailModal), app.js (switchView).

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

// A real calendar month's collected (paid-invoice) revenue — monthsAgo=0
// is the current month, 1 is the previous one. Used both for the Vitals
// strip and the Cash Position card; two real periods, never a fabricated
// trend line.
function ccMonthCollectedUSD(deals, monthsAgo) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const y = target.getFullYear(), m = target.getMonth();
  let sum = 0;
  deals.forEach(d => (d.invoices || []).forEach(inv => {
    if (inv.status !== 'paid' || !inv.date) return;
    const dt = new Date(inv.date);
    if (dt.getFullYear() === y && dt.getMonth() === m) sum += toUSD(invoiceTotal(inv.items), inv.currency);
  }));
  return sum;
}

// ================= 1. Vitals strip =================
const CX_VITAL_DEFS = [
  { key: 'collectedUSD', label: 'Collected (all-time)', icon: 'bi-cash-stack', good: 'up' },
  { key: 'outstandingUSD', label: 'Outstanding', icon: 'bi-hourglass-split', good: 'down' },
  { key: 'pipelineUSD', label: 'Pipeline value', icon: 'bi-graph-up-arrow', good: 'up' },
  { key: 'winRate', label: 'Win rate', icon: 'bi-trophy', good: 'up' },
];

function renderCxVitals(deals) {
  const dateEl = document.getElementById('cxDateLabel');
  const greetEl = document.getElementById('cxGreeting');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (greetEl) greetEl.textContent = greetingWord();

  const pillEl = document.getElementById('cxAttentionPill');
  if (pillEl) {
    const count = typeof getAttentionCounts === 'function' ? getAttentionCounts() : 0;
    pillEl.className = 'cx-vitals__pill ' + (count > 0 ? 'cx-vitals__pill--danger' : 'cx-vitals__pill--clear');
    pillEl.innerHTML = count > 0
      ? '<i class="bi bi-exclamation-triangle-fill"></i>' + count + (count === 1 ? ' item needs attention' : ' items need attention')
      : '<i class="bi bi-check-circle-fill"></i>All caught up';
  }

  const metricsEl = document.getElementById('cxVitalsMetrics');
  if (!metricsEl) return;
  const s = typeof computeOverviewStats === 'function' ? computeOverviewStats(deals) : {};

  metricsEl.innerHTML = CX_VITAL_DEFS.map(c => {
    const raw = s[c.key];
    const value = c.key === 'winRate'
      ? ((raw === null || raw === undefined) ? '—' : Math.round(raw) + '%')
      : formatUSD(raw);
    let deltaHtml = '';
    const delta = typeof getMetricDelta === 'function' ? getMetricDelta(c.key, raw, 7) : null;
    if (delta && delta.direction !== 'flat') {
      const isGood = delta.direction === c.good;
      deltaHtml = '<span class="cx-metric__delta ' + (isGood ? 'cx-metric__delta--good' : 'cx-metric__delta--bad') + '">' +
        (delta.direction === 'up' ? '▲' : '▼') + ' ' + deltaText(c.key, delta) + '</span>';
    }
    return '' +
      '<div class="cx-metric">' +
        '<span class="cx-metric__label"><i class="bi ' + c.icon + '"></i> ' + c.label + '</span>' +
        '<div class="cx-metric__value-row"><span class="cx-metric__value">' + value + '</span>' + deltaHtml + '</div>' +
      '</div>';
  }).join('');
}

// ================= 2. Cash Position =================
function cxOverdueInvoiceRow(entry) {
  const amountLabel = formatInvoiceAmount(invoiceTotal(entry.invoice.items), entry.invoice.currency);
  const days = daysUntilDateStr(entry.invoice.dueDate);
  const urgencyLabel = days === null ? 'No due date' : days < 0 ? Math.round(-days) + 'd overdue' : 'due in ' + Math.round(days) + 'd';
  const reminder = typeof buildReminderLink === 'function' ? buildReminderLink(entry.deal, entry.invoice, amountLabel) : null;

  return '' +
    '<div class="cx-cash-row">' +
      '<div class="cx-cash-row__main">' +
        '<span class="cx-cash-row__name">' + escapeHtml(entry.deal.entityName || 'Untitled entity') + '</span>' +
        '<span class="cx-cash-row__meta">' + escapeHtml(entry.invoice.number) + ' · ' + escapeHtml(urgencyLabel) + '</span>' +
      '</div>' +
      '<span class="cx-cash-row__amount">' + amountLabel + '</span>' +
      (reminder ? '<a class="btn btn-sm btn-outline-secondary cx-cash-row__btn" href="' + escapeHtml(reminder.href) + '" target="_blank" rel="noopener" title="' + reminder.label + '"><i class="bi ' + reminder.icon + '"></i></a>' : '') +
    '</div>';
}

function renderCxCash(deals) {
  const figureEl = document.getElementById('cxCashFigure');
  const deltaEl = document.getElementById('cxCashDelta');
  const goalEl = document.getElementById('cxCashGoal');
  const listEl = document.getElementById('cxCashOverdueList');
  if (!figureEl) return;

  const collected = ccMonthCollectedUSD(deals, 0);
  const lastMonth = ccMonthCollectedUSD(deals, 1);
  figureEl.textContent = formatUSD(collected);

  if (lastMonth > 0) {
    const diff = collected - lastMonth;
    const pct = Math.round((diff / lastMonth) * 100);
    deltaEl.className = 'cx-cash__delta ' + (diff >= 0 ? 'cx-cash__delta--good' : 'cx-cash__delta--bad');
    deltaEl.textContent = (diff >= 0 ? '▲ ' : '▼ ') + formatUSD(Math.abs(diff)) + ' (' + (pct >= 0 ? '+' : '') + pct + '%) vs last month';
  } else {
    deltaEl.className = 'cx-cash__delta cx-cash__delta--neutral';
    deltaEl.textContent = 'No collections last month to compare against';
  }

  const goal = typeof getRevenueGoal === 'function' ? getRevenueGoal() : 0;
  const totalCollected = typeof getTotalCollectedUSD === 'function' ? getTotalCollectedUSD() : 0;
  if (goal > 0) {
    const pct = Math.min(100, Math.round((totalCollected / goal) * 100));
    goalEl.innerHTML = '' +
      '<div class="cx-cash__goal-bar"><span style="width:' + pct + '%"></span></div>' +
      '<span class="cx-cash__goal-label">' + formatUSD(totalCollected) + ' of ' + formatUSD(goal) + ' goal (' + pct + '%) <button type="button" class="link-btn" data-set-goal="1">Edit</button></span>';
  } else {
    goalEl.innerHTML = '<div class="cx-cash__goal-empty"><span class="cx-cash__goal-label">No revenue goal set.</span><button type="button" class="btn btn-sm btn-ink" data-set-goal="1">Set a goal</button></div>';
  }

  const flat = typeof getAllInvoicesFlat === 'function' ? getAllInvoicesFlat() : [];
  const outstanding = flat.filter(({ invoice }) => invoice.status !== 'paid' && invoiceTotal(invoice.items) > 0);
  outstanding.sort((a, b) => {
    const da = daysUntilDateStr(a.invoice.dueDate);
    const db = daysUntilDateStr(b.invoice.dueDate);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
  const top3 = outstanding.slice(0, 3);
  listEl.innerHTML = top3.length ? top3.map(cxOverdueInvoiceRow).join('') : '<p class="cc-empty-note">Nothing outstanding — everything is collected.</p>';
}

// ================= 3. Priority Actions + Pipeline Funnel =================
function renderCxPriorityList() {
  const el = document.getElementById('cxPriorityList');
  if (!el) return;
  const items = typeof buildUnifiedAttentionItems === 'function' ? buildUnifiedAttentionItems().slice(0, 5) : [];
  el.innerHTML = items.length
    ? items.map(attentionPriorityCard).join('')
    : '<p class="attention-clear"><i class="bi bi-check-lg"></i>Nothing needs attention right now</p>';
}

const CX_FUNNEL_STAGES = ['new', 'contacted', 'proposal', 'negotiation', 'won'];
const CX_FUNNEL_LABELS = { new: 'New', contacted: 'Contacted', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won' };

function renderCxFunnel(deals) {
  const el = document.getElementById('cxFunnel');
  if (!el) return;
  if (deals.length === 0) {
    el.innerHTML = '<p class="cc-empty-note">No deals recorded yet.</p>';
    return;
  }

  const counts = CX_FUNNEL_STAGES.map(s => deals.filter(d => d.stage === s).length);
  const values = CX_FUNNEL_STAGES.map(s => deals.filter(d => d.stage === s).reduce((sum, d) => sum + toUSD(d.value, d.currency), 0));
  const max = Math.max(...counts, 1);

  let html = '';
  CX_FUNNEL_STAGES.forEach((stage, i) => {
    const widthPct = Math.max(6, (counts[i] / max) * 100);
    html += '' +
      '<div class="cx-funnel-row">' +
        '<span class="cx-funnel-row__label">' + CX_FUNNEL_LABELS[stage] + '</span>' +
        '<span class="cx-funnel-row__track"><span class="cx-funnel-row__fill cx-funnel-row__fill--' + stage + '" style="width:' + widthPct + '%"></span></span>' +
        '<span class="cx-funnel-row__value">' + counts[i] + ' · ' + formatUSD(values[i]) + '</span>' +
      '</div>';
    if (i < CX_FUNNEL_STAGES.length - 1 && counts[i] > 0) {
      const dropoff = Math.round((1 - counts[i + 1] / counts[i]) * 100);
      html += '<div class="cx-funnel-drop"><i class="bi bi-arrow-down-short"></i>' + dropoff + '% drop-off</div>';
    }
  });
  el.innerHTML = html;
}

// ================= 4. Active Work (Deals + Projects, one toggle) =================
let cxWorkMode = 'sales'; // 'sales' | 'delivery'

const CX_STAGE_PROGRESS_PCT = { new: 15, contacted: 40, proposal: 65, negotiation: 90 };

function cxDealCard(deal) {
  const pct = CX_STAGE_PROGRESS_PCT[deal.stage] || 10;
  const overdue = isOverdue(deal);
  const closeLabel = deal.closeDate
    ? new Date(deal.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'No close date';
  const lastActive = timeAgo(lastActivityTimestamp(deal));
  const payment = dealPaymentStatus(deal);

  return '' +
    '<button type="button" class="project-card" data-id="' + deal.id + '">' +
      '<div class="project-card__head">' +
        '<span class="project-card__type"><i class="bi bi-journal-text"></i>' + (deal.fieldOfWork ? escapeHtml(deal.fieldOfWork) : 'Deal') + '</span>' +
        '<span class="stage-badge stage-badge--' + deal.stage + '">' + deal.stage + '</span>' +
      '</div>' +
      '<div class="project-card__name">' + escapeHtml(deal.entityName || 'Untitled entity') + '</div>' +
      '<div class="project-card__progress">' +
        '<div class="project-card__progress-bar"><span style="width:' + pct + '%"></span></div>' +
        '<span class="project-card__progress-label">' + pct + '% through pipeline</span>' +
      '</div>' +
      '<div class="cx-work-card__badges">' + workStatusBadge(deal.workStatus) + '<span class="payment-status-badge payment-status-badge--' + payment.tone + '">' + payment.label + '</span></div>' +
      '<div class="cx-work-card__foot">' +
        '<span class="' + (overdue ? 'cx-work-card__close--overdue' : '') + '"><i class="bi ' + (overdue ? 'bi-exclamation-circle-fill' : 'bi-calendar-event') + '"></i>' + escapeHtml(closeLabel) + '</span>' +
        (lastActive ? '<span><i class="bi bi-clock-history"></i>' + escapeHtml(lastActive) + '</span>' : '') +
      '</div>' +
    '</button>';
}

function cxProjectMoney(project) {
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

function cxProjectCard(project) {
  const typeMeta = PROJECT_TYPE_META[project.type] || PROJECT_TYPE_META.other;
  const progress = projectPhaseProgress(project);
  const deal = project.dealId ? getDeals().find(d => d.id === project.dealId) : null;
  const clientLabel = deal ? (deal.entityName || 'Untitled entity') : project.clientName;
  const money = cxProjectMoney(project);

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
      '<div class="cx-work-card__money cx-work-card__money--' + money.tone + '"><i class="bi bi-cash-coin"></i>' + escapeHtml(money.text) + '</div>' +
    '</button>';
}

function renderCxWorkSales(deals, statsEl, gridEl) {
  const open = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  if (open.length === 0) {
    statsEl.innerHTML = '';
    gridEl.innerHTML = '<p class="cc-empty-note">No open deals right now — new deals will track their progress here.</p>';
    return;
  }

  const openValueUSD = open.reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  const overdueCount = open.filter(d => isOverdue(d)).length;
  const dayMs = 24 * 60 * 60 * 1000;
  const soonCutoff = Date.now() + 7 * dayMs;
  const closingSoonCount = open.filter(d => d.closeDate && new Date(d.closeDate).getTime() >= Date.now() && new Date(d.closeDate).getTime() <= soonCutoff).length;
  const ages = open.map(d => (Date.now() - (d.createdAt || Date.now())) / dayMs);
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;

  statsEl.innerHTML = [
    ['Open deals', open.length, 'bi-journal-text', 'cyan'],
    ['Open value', formatUSD(openValueUSD), 'bi-cash-stack', 'slate'],
    ['Overdue', overdueCount, 'bi-exclamation-circle', overdueCount > 0 ? 'danger' : 'slate'],
    ['Closing this week', closingSoonCount, 'bi-hourglass-split', 'amber'],
    ['Avg. days open', avgAge + 'd', 'bi-stopwatch', 'slate'],
  ].map(([label, value, icon, tone]) =>
    '<div class="attention-stat attention-stat--' + tone + '">' +
      '<i class="bi ' + icon + '"></i>' +
      '<span class="attention-stat__figure">' + value + '</span>' +
      '<span class="attention-stat__label">' + label + '</span>' +
    '</div>'
  ).join('');

  const sorted = open.slice().sort((a, b) => {
    const aOverdue = isOverdue(a), bOverdue = isOverdue(b);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    const aClose = a.closeDate ? new Date(a.closeDate).getTime() : Infinity;
    const bClose = b.closeDate ? new Date(b.closeDate).getTime() : Infinity;
    if (aClose !== bClose) return aClose - bClose;
    return (lastActivityTimestamp(b) || 0) - (lastActivityTimestamp(a) || 0);
  }).slice(0, 6);

  gridEl.innerHTML = sorted.map(cxDealCard).join('');
}

function renderCxWorkDelivery(statsEl, gridEl) {
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
  gridEl.innerHTML = shown.map(cxProjectCard).join('');
}

function renderCxWork(deals) {
  const statsEl = document.getElementById('cxWorkStats');
  const gridEl = document.getElementById('cxWorkGrid');
  const viewAllLink = document.getElementById('cxWorkViewAllLink');
  if (!statsEl || !gridEl) return;

  if (viewAllLink) viewAllLink.dataset.jumpView = cxWorkMode === 'sales' ? 'deals' : 'projects';

  if (cxWorkMode === 'sales') renderCxWorkSales(deals, statsEl, gridEl);
  else renderCxWorkDelivery(statsEl, gridEl);
}

// ================= 5. Trends =================
let cxRevenueChartInstance = null;
let cxPerformanceChartInstance = null;

function renderCxRevenueChart(deals) {
  const el = document.getElementById('cxRevenueChart');
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
    chart: Object.assign({}, base.chart, { type: 'area', height: 220 }),
    xaxis: { categories: last.map(monthLabel), labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) }, forceNiceScale: true },
    stroke: { curve: 'smooth', width: 3 },
    colors: [lineColor],
    fill: { type: 'gradient', gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.35, opacityFrom: 0.4, opacityTo: 0.04, stops: [0, 100] } },
    markers: { size: 4, colors: [lineColor], strokeColors: dark ? '#2A2A2A' : '#fff', strokeWidth: 2 },
    dataLabels: { enabled: false },
    tooltip: Object.assign({}, base.tooltip, { y: { formatter: (v) => formatUSD(v) } }),
  });

  if (cxRevenueChartInstance) cxRevenueChartInstance.destroy();
  cxRevenueChartInstance = new ApexCharts(el, options);
  cxRevenueChartInstance.render();
}

// Combined win-rate + avg-deal-size chart, both computed directly from
// real deal records (grouped by the month a deal last changed) — no
// snapshot history required, so this works from day one even on a fresh
// database. Months with no won/lost outcome show a gap in the win-rate
// line rather than a fabricated 0%.
function renderCxPerformanceChart(deals) {
  const el = document.getElementById('cxPerformanceChart');
  if (!el) return;

  if (deals.length === 0) {
    el.innerHTML = '<p class="cc-empty-note">Record a deal to see this chart.</p>';
    return;
  }

  const byMonth = new Map();
  deals.forEach(d => {
    const key = monthKey(d.updatedAt || d.createdAt);
    if (!byMonth.has(key)) byMonth.set(key, { won: 0, lost: 0, sizeSum: 0, sizeCount: 0 });
    const bucket = byMonth.get(key);
    if (d.stage === 'won') bucket.won++;
    if (d.stage === 'lost') bucket.lost++;
    bucket.sizeSum += toUSD(d.value, d.currency);
    bucket.sizeCount++;
  });
  const keys = Array.from(byMonth.keys()).sort();
  const last = keys.slice(-9);

  const winRates = last.map(k => {
    const b = byMonth.get(k);
    const total = b.won + b.lost;
    return total ? Math.round((b.won / total) * 100) : null;
  });
  const avgSizes = last.map(k => {
    const b = byMonth.get(k);
    return b.sizeCount ? Math.round(b.sizeSum / b.sizeCount) : 0;
  });

  el.innerHTML = '';
  const base = chartBase();
  const dark = isDarkTheme();

  const options = Object.assign({}, base, {
    series: [
      { name: 'Win rate', type: 'line', data: winRates },
      { name: 'Avg deal size', type: 'column', data: avgSizes },
    ],
    chart: Object.assign({}, base.chart, { type: 'line', height: 220 }),
    stroke: { width: [3, 0], curve: 'smooth' },
    xaxis: { categories: last.map(monthLabel), labels: { style: { colors: '#94A0B8' } } },
    yaxis: [
      { seriesName: 'Win rate', min: 0, max: 100, labels: { style: { colors: '#94A0B8' }, formatter: (v) => (v === null || v === undefined) ? '' : Math.round(v) + '%' } },
      { seriesName: 'Avg deal size', opposite: true, labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) } },
    ],
    colors: [dark ? '#4CC2FF' : '#0F6CBD', dark ? '#C29CFF' : '#7719AA'],
    plotOptions: { bar: { columnWidth: '40%', borderRadius: 4 } },
    markers: { size: 4 },
    dataLabels: { enabled: false },
    legend: { position: 'top', fontSize: '11px', labels: { colors: dark ? '#96A0B5' : '#5B6478' } },
    tooltip: Object.assign({}, base.tooltip, {
      y: [
        { formatter: (v) => (v === null || v === undefined) ? 'No won/lost deals' : v + '%' },
        { formatter: (v) => formatUSD(v) },
      ],
    }),
  });

  if (cxPerformanceChartInstance) cxPerformanceChartInstance.destroy();
  cxPerformanceChartInstance = new ApexCharts(el, options);
  cxPerformanceChartInstance.render();
}

// ================= 6. Growth signals =================
function cxSignalRow(name, valueLabel, dataAttrs) {
  return '<button type="button" class="cx-signal-row" ' + dataAttrs + '><span class="cx-signal-row__name">' + escapeHtml(name) + '</span><span class="cx-signal-row__value">' + valueLabel + '</span></button>';
}

function renderCxTopClients(deals) {
  const el = document.getElementById('cxTopClients');
  if (!el) return;
  const groups = new Map();
  deals.forEach(d => {
    if (!d.entityName) return;
    const key = d.entityName.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: d.entityName, valueUSD: 0 });
    groups.get(key).valueUSD += toUSD(d.value, d.currency);
  });
  const top = Array.from(groups.values()).sort((a, b) => b.valueUSD - a.valueUSD).slice(0, 4);
  el.innerHTML = top.length
    ? top.map(c => cxSignalRow(c.name, formatUSD(c.valueUSD), 'data-jump-entity="' + escapeHtml(c.name) + '"')).join('')
    : '<p class="cc-empty-note">No deals yet.</p>';
}

function renderCxTopReferrals() {
  const el = document.getElementById('cxTopReferrals');
  if (!el) return;
  const groups = typeof buildReferralGroups === 'function' ? buildReferralGroups() : [];
  const top = groups
    .map(g => ({ name: g.name, valueUSD: g.deals.reduce((s, d) => s + toUSD(d.value, d.currency), 0) }))
    .sort((a, b) => b.valueUSD - a.valueUSD)
    .slice(0, 4);
  el.innerHTML = top.length
    ? top.map(r => cxSignalRow(r.name, formatUSD(r.valueUSD), 'data-jump-referral="' + escapeHtml(r.name) + '"')).join('')
    : '<p class="cc-empty-note">No referrals logged yet.</p>';
}

function renderCxRecentWins(deals) {
  const el = document.getElementById('cxRecentWins');
  if (!el) return;
  const wins = deals.filter(d => d.stage === 'won').slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 4);
  el.innerHTML = wins.length
    ? wins.map(d => cxSignalRow(d.entityName || 'Untitled entity', formatUSD(toUSD(d.value, d.currency)), 'data-id="' + d.id + '"')).join('')
    : '<p class="cc-empty-note">No wins yet.</p>';
}

// ================= Orchestration =================
function renderToday() {
  const deals = getDeals();
  renderCxVitals(deals);
  renderCxCash(deals);
  renderCxPriorityList();
  renderCxFunnel(deals);
  renderCxWork(deals);
  renderCxRevenueChart(deals);
  renderCxPerformanceChart(deals);
  renderCxTopClients(deals);
  renderCxTopReferrals();
  renderCxRecentWins(deals);
}

// ================= Shared interactions =================
document.getElementById('todayView').addEventListener('click', (e) => {
  const jumpBtn = e.target.closest('[data-jump-view]');
  if (jumpBtn) { switchView(jumpBtn.dataset.jumpView); return; }

  const workModeBtn = e.target.closest('[data-work-mode]');
  if (workModeBtn) {
    cxWorkMode = workModeBtn.dataset.workMode;
    document.querySelectorAll('#cxWorkToggle .cx-toggle__btn').forEach(b => b.classList.toggle('is-active', b === workModeBtn));
    renderCxWork(getDeals());
    return;
  }

  const goalBtn = e.target.closest('[data-set-goal]');
  if (goalBtn) {
    const val = Number(prompt('Set revenue goal (USD):', (typeof getRevenueGoal === 'function' ? getRevenueGoal() : '') || ''));
    if (val > 0) { setRevenueGoal(val); renderCxCash(getDeals()); }
    return;
  }

  const todoEl = e.target.closest('[data-todo-id]');
  if (todoEl) { switchView('todos'); openTodoModal(todoEl.dataset.todoId); return; }

  const debtEl = e.target.closest('[data-debt-id]');
  if (debtEl) { switchView('debts'); openDebtModal(debtEl.dataset.debtId); return; }

  const contactEl = e.target.closest('[data-contact-key]');
  if (contactEl) { switchView('contacts'); openContactUpdateModal(contactEl.dataset.contactKey, contactEl.dataset.contactName); return; }

  const entityEl = e.target.closest('[data-jump-entity]');
  if (entityEl) { switchView('deals', { searchTerm: entityEl.dataset.jumpEntity }); return; }

  const referralEl = e.target.closest('[data-jump-referral]');
  if (referralEl) { switchView('referrals', { searchTerm: referralEl.dataset.jumpReferral }); return; }

  const projectEl = e.target.closest('[data-open-project]');
  if (projectEl) { switchView('projects'); openProjectModal(projectEl.dataset.openProject); return; }

  const dealEl = e.target.closest('[data-id]');
  if (dealEl) { switchView('deals'); openDetailModal(dealEl.dataset.id); }
});
