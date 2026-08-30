/* ============================================================
   deals-table.js
   ------------------------------------------------------------
   The Deals tab: search, the clickable money-stat cards, the
   pipeline funnel (which doubles as the stage filter — there's
   no separate row of filter chips anymore), sortable column
   headers, and row rendering + row click actions.

   The wizard (deals-wizard.js) and the read-only detail popup
   (deals-detail.js) are separate files — this one only opens them
   via the global openWizard()/openDetailModal() functions they
   expose, so editing "what a row looks like" never requires
   touching wizard or detail code.

   Exposes: renderDeals(), setDealsSearch(term)
   ============================================================ */

// ---------- DOM refs ----------
const dealsSearchInput = document.getElementById('searchInput');
const sortableHeaders = document.querySelectorAll('#dealsView th.sortable');
const dealsTableBody = document.getElementById('dealsTableBody');
const dealsEmptyState = document.getElementById('emptyState');
const dealsNoResultsState = document.getElementById('noResultsState');

const totalOpenValueEl = document.getElementById('totalOpenValue');
const totalWonValueEl = document.getElementById('totalWonValue');
const totalDeliveredValueEl = document.getElementById('totalDeliveredValue');
const totalNotPaidValueEl = document.getElementById('totalNotPaidValue');
const totalCountEl = document.getElementById('totalCount');
const moneyStatsGrid = document.getElementById('moneyStatsGrid');
const pipelineFunnel = document.getElementById('pipelineFunnel');

let dealsTrendChartInstance = null;
let dealsMixChartInstance = null;
let collectionEfficiencyChartInstance = null;

// ---------- State ----------
let activeStageFilter = 'all';
let activeMoneyFilter = null; // 'potential' | 'won' | 'delivered' | 'notpaid' | null
let dealsSearchTerm = '';
let sortColumn = 'index';   // matches a th[data-sort] key
let sortDirection = 'desc'; // 'asc' | 'desc' — default mirrors "newest first"

const FUNNEL_STAGES = ['new', 'contacted', 'proposal', 'negotiation'];
const OUTCOME_STAGES = ['won', 'lost'];
const STAGE_LABELS = { new: 'New', contacted: 'Contacted', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
const STAGE_RANK = { new: 0, contacted: 1, proposal: 2, negotiation: 3, won: 4, lost: 5 };

// ---------- Filter / sort ----------
const SORT_COMPARATORS = {
  index: (a, b) => a.entryIndex - b.entryIndex,
  name: (a, b) => (a.entityName || '').localeCompare(b.entityName || ''),
  value: (a, b) => toUSD(a.value, a.currency) - toUSD(b.value, b.currency),
  stage: (a, b) => (STAGE_RANK[a.stage] || 0) - (STAGE_RANK[b.stage] || 0),
  close: (a, b) => (a.closeDate || '').localeCompare(b.closeDate || ''),
  activity: (a, b) => (lastActivityTimestamp(a) || 0) - (lastActivityTimestamp(b) || 0),
};

function dealHasPaidInvoice(deal) {
  return (deal.invoices || []).some(inv => inv.status === 'paid');
}

function matchesMoneyFilter(deal, filter) {
  if (!filter) return true;
  if (filter === 'potential') return deal.stage !== 'won' && deal.stage !== 'lost';
  if (filter === 'won') return deal.stage === 'won';
  if (filter === 'delivered') return dealHasPaidInvoice(deal);
  if (filter === 'notpaid') return deal.stage === 'won' && dealPaymentStatus(deal).remainingUSD > 0.01;
  return true;
}

function getFilteredSortedDeals() {
  let deals = getDeals();

  if (activeStageFilter !== 'all') {
    deals = deals.filter(d => d.stage === activeStageFilter);
  }
  if (activeMoneyFilter) {
    deals = deals.filter(d => matchesMoneyFilter(d, activeMoneyFilter));
  }

  if (dealsSearchTerm.trim()) {
    const term = dealsSearchTerm.trim().toLowerCase();
    deals = deals.filter(d =>
      (d.entityName || '').toLowerCase().includes(term) ||
      (d.fieldOfWork || '').toLowerCase().includes(term) ||
      ((d.referral && d.referral.name) || '').toLowerCase().includes(term) ||
      ((d.firstContact && d.firstContact.name) || '').toLowerCase().includes(term) ||
      ((d.projectManager && d.projectManager.name) || '').toLowerCase().includes(term)
    );
  }

  const cmp = SORT_COMPARATORS[sortColumn] || SORT_COMPARATORS.index;
  const sign = sortDirection === 'asc' ? 1 : -1;
  return deals.slice().sort((a, b) => sign * cmp(a, b));
}

function updateSortHeaderUI() {
  sortableHeaders.forEach(th => {
    const isActive = th.dataset.sort === sortColumn;
    th.classList.toggle('is-sorted', isActive);
    const icon = th.querySelector('.sort-icon');
    icon.className = 'bi sort-icon ' + (isActive ? (sortDirection === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down') : 'bi-arrow-down-up');
  });
}

sortableHeaders.forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortColumn === key) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = key;
      sortDirection = key === 'name' ? 'asc' : 'desc';
    }
    renderDeals();
  });
});

// ---------- Money-stat cards (clickable totals) ----------
function updateTotals(allDeals) {
  const potentialDeals = allDeals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  const wonDeals = allDeals.filter(d => d.stage === 'won');

  const potentialUSD = potentialDeals.reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  const wonUSD = wonDeals.reduce((s, d) => s + toUSD(d.value, d.currency), 0);

  // "Delivered" = money actually collected: every paid invoice, across every deal.
  let deliveredUSD = 0;
  allDeals.forEach(d => {
    (d.invoices || []).forEach(inv => {
      if (inv.status === 'paid') deliveredUSD += toUSD(invoiceTotal(inv.items), inv.currency);
    });
  });

  const notPaidUSD = Math.max(0, wonUSD - deliveredUSD);

  totalOpenValueEl.innerHTML = formatDualCurrency(potentialUSD, 'USD');
  totalWonValueEl.innerHTML = formatDualCurrency(wonUSD, 'USD');
  totalDeliveredValueEl.innerHTML = formatDualCurrency(deliveredUSD, 'USD');
  totalNotPaidValueEl.innerHTML = formatDualCurrency(notPaidUSD, 'USD');
  totalCountEl.textContent = allDeals.length;

  moneyStatsGrid.querySelectorAll('.money-stat-card').forEach(card => {
    card.classList.toggle('is-active', card.dataset.moneyFilter === activeMoneyFilter);
  });
}

moneyStatsGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.money-stat-card');
  if (!card) return;
  const filter = card.dataset.moneyFilter;
  activeMoneyFilter = activeMoneyFilter === filter ? null : filter;
  renderDeals();
});

// ---------- Pipeline funnel (also the stage filter — replaces the old chip row) ----------
function pipelineCardHtml(stage, count, valueUSD, isOutcome) {
  const isActive = activeStageFilter === stage;
  return '' +
    '<button type="button" class="pipeline-card pipeline-card--' + stage + (isActive ? ' is-active' : '') + (isOutcome ? ' pipeline-card--outcome' : '') + '" data-stage="' + stage + '">' +
      '<span class="pipeline-card__label">' + STAGE_LABELS[stage] + '</span>' +
      '<span class="pipeline-card__count">' + count + '</span>' +
      '<span class="pipeline-card__value">' + formatUSD(valueUSD) + '</span>' +
    '</button>';
}

function renderPipelineFunnel(allDeals) {
  const byStage = {};
  FUNNEL_STAGES.concat(OUTCOME_STAGES).forEach(s => { byStage[s] = { count: 0, value: 0 }; });
  allDeals.forEach(d => {
    if (!byStage[d.stage]) return;
    byStage[d.stage].count += 1;
    byStage[d.stage].value += toUSD(d.value, d.currency);
  });

  const funnelHtml = FUNNEL_STAGES.map((stage, i) => {
    const card = pipelineCardHtml(stage, byStage[stage].count, byStage[stage].value, false);
    return card + (i < FUNNEL_STAGES.length - 1 ? '<i class="bi bi-chevron-right pipeline-arrow"></i>' : '');
  }).join('');

  const outcomeHtml = OUTCOME_STAGES.map(stage => pipelineCardHtml(stage, byStage[stage].count, byStage[stage].value, true)).join('');

  pipelineFunnel.innerHTML =
    '<div class="pipeline-funnel__steps">' + funnelHtml + '</div>' +
    '<div class="pipeline-funnel__divider"><i class="bi bi-arrow-right"></i></div>' +
    '<div class="pipeline-funnel__outcomes">' + outcomeHtml + '</div>';
}

pipelineFunnel.addEventListener('click', (e) => {
  const card = e.target.closest('.pipeline-card');
  if (!card) return;
  const stage = card.dataset.stage;
  activeStageFilter = activeStageFilter === stage ? 'all' : stage;
  renderDeals();
});

// ---------- Active filter banner ----------
function renderActiveFilterBanner() {
  let banner = document.getElementById('activeFilterBanner');
  const hasFilter = activeStageFilter !== 'all' || activeMoneyFilter;

  if (!hasFilter) {
    if (banner) banner.remove();
    return;
  }

  const parts = [];
  if (activeStageFilter !== 'all') parts.push(STAGE_LABELS[activeStageFilter] + ' stage');
  if (activeMoneyFilter) parts.push({ potential: 'Potential', won: 'Won', delivered: 'Delivered', notpaid: 'Not paid' }[activeMoneyFilter]);

  const html = '<span><i class="bi bi-funnel"></i> Showing: ' + parts.join(' · ') + '</span><button type="button" id="clearFiltersBtn">Clear</button>';

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'activeFilterBanner';
    banner.className = 'active-filter-banner';
    document.querySelector('#dealsView .ledger-toolbar').insertAdjacentElement('afterend', banner);
    banner.addEventListener('click', (e) => {
      if (e.target.closest('#clearFiltersBtn')) {
        activeStageFilter = 'all';
        activeMoneyFilter = null;
        renderDeals();
      }
    });
  }
  banner.innerHTML = html;
}

// ---------- Live analytics row: Pipeline vs Won / Stage mix / Collection efficiency ----------
function renderDealsTrendChart(allDeals) {
  const el = document.getElementById('dealsTrendChart');
  if (!el) return;

  const newByMonth = new Map();
  const wonByMonth = new Map();
  allDeals.forEach(d => {
    const newKey = monthKey(d.createdAt);
    newByMonth.set(newKey, (newByMonth.get(newKey) || 0) + toUSD(d.value, d.currency));
    if (d.stage === 'won') {
      // No dedicated "won at" timestamp exists in the data model — updatedAt
      // is the closest real signal we have, so this is explicitly labeled
      // "approximate" in the chart's subtitle rather than presented as exact.
      const wonKey = monthKey(d.updatedAt || d.createdAt);
      wonByMonth.set(wonKey, (wonByMonth.get(wonKey) || 0) + toUSD(d.value, d.currency));
    }
  });
  const keys = Array.from(new Set([...newByMonth.keys(), ...wonByMonth.keys()])).sort();
  const last = keys.slice(-6);
  const base = chartBase();

  const options = Object.assign({}, base, {
    series: [
      { name: 'New pipeline', data: last.map(k => Math.round(newByMonth.get(k) || 0)) },
      { name: 'Won (approx.)', data: last.map(k => Math.round(wonByMonth.get(k) || 0)) },
    ],
    chart: Object.assign({}, base.chart, { type: 'bar', height: 200 }),
    plotOptions: { bar: { borderRadius: 4, columnWidth: '55%' } },
    xaxis: { categories: last.map(monthLabel), labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) } },
    colors: ['#8BBEE8', '#0078D4'],
    legend: { position: 'top', fontSize: '11px', labels: { colors: isDarkTheme() ? '#96A0B5' : '#5B6478' } },
    dataLabels: { enabled: false },
  });

  if (dealsTrendChartInstance) dealsTrendChartInstance.destroy();
  dealsTrendChartInstance = new ApexCharts(el, options);
  dealsTrendChartInstance.render();
}

function renderDealsMixChart(allDeals) {
  const el = document.getElementById('dealsMixChart');
  if (!el) return;
  const won = allDeals.filter(d => d.stage === 'won').length;
  const active = allDeals.filter(d => d.stage === 'proposal' || d.stage === 'negotiation').length;
  const others = allDeals.length - won - active;
  const base = chartBase();
  const dark = isDarkTheme();

  const options = {
    series: [won, active, others],
    labels: ['Won', 'Proposal/Negotiation', 'Others'],
    chart: Object.assign({}, base.chart, { type: 'donut', height: 200 }),
    colors: ['#0F7B0F', '#9D5D00', '#8A8886'],
    legend: { position: 'bottom', fontSize: '11px', labels: { colors: dark ? '#96A0B5' : '#5B6478' } },
    dataLabels: { enabled: false },
    stroke: { colors: [dark ? '#2C2C2C' : '#FFFFFF'], width: 2 },
    plotOptions: { pie: { donut: { labels: { show: true, total: { show: true, label: 'Total deals', formatter: () => String(allDeals.length) } } } } },
    tooltip: { theme: dark ? 'dark' : 'light' },
  };

  if (dealsMixChartInstance) dealsMixChartInstance.destroy();
  dealsMixChartInstance = new ApexCharts(el, options);
  dealsMixChartInstance.render();
}

function renderCollectionEfficiencyChart(allDeals) {
  const el = document.getElementById('collectionEfficiencyChart');
  if (!el) return;
  el.innerHTML = '';

  const wonUSD = allDeals.filter(d => d.stage === 'won').reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  const collectedUSD = getTotalCollectedUSD();
  const pct = wonUSD > 0 ? Math.min(100, Math.round((collectedUSD / wonUSD) * 100)) : 0;
  const dark = isDarkTheme();
  const base = chartBase();

  const chartEl = document.createElement('div');
  el.appendChild(chartEl);

  const options = {
    series: [pct],
    chart: Object.assign({}, base.chart, { type: 'radialBar', height: 170 }),
    plotOptions: { radialBar: { hollow: { size: '58%' }, dataLabels: { name: { show: false }, value: { fontSize: '20px', fontWeight: 700, color: dark ? '#fff' : '#1B1B1B', formatter: (v) => v + '%' } } } },
    colors: ['#0F7B0F'],
    labels: ['Collected'],
  };

  if (collectionEfficiencyChartInstance) collectionEfficiencyChartInstance.destroy();
  collectionEfficiencyChartInstance = new ApexCharts(chartEl, options);
  collectionEfficiencyChartInstance.render();

  el.insertAdjacentHTML('beforeend',
    '<div class="collection-efficiency-figures">' +
      '<div><span>Won</span><strong class="mono-figure">' + formatUSD(wonUSD) + '</strong></div>' +
      '<div><span>Collected</span><strong class="mono-figure">' + formatUSD(collectedUSD) + '</strong></div>' +
    '</div>'
  );
}

function renderDealsAnalytics(allDeals) {
  if (allDeals.length === 0) return;
  renderDealsTrendChart(allDeals);
  renderDealsMixChart(allDeals);
  renderCollectionEfficiencyChart(allDeals);
}

// ---------- Row rendering ----------
function paymentCellHtml(deal) {
  const status = dealPaymentStatus(deal);
  const remainingText = status.remainingUSD > 0.01 ? formatUSD(status.remainingUSD) + ' left' : '';
  return '<span class="payment-status-badge payment-status-badge--' + status.tone + '">' + status.label + '</span>' +
    (remainingText ? '<div class="payment-cell__remaining">' + remainingText + '</div>' : '');
}

function mostRecentUpdate(deal) {
  const log = deal.commLog || [];
  if (!log.length) return null;
  const sorted = log.slice().sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
  return sorted[0];
}

// A deal's "health" — deliberately categorical (not a fabricated precise
// score), derived only from real signals we actually have: whether it's
// overdue, and how long since real activity was logged. Won/lost deals
// don't get a health bar — the concept doesn't apply once a deal is closed.
function dealHealthTier(deal) {
  if (deal.stage === 'won' || deal.stage === 'lost') return null;
  if (isOverdue(deal)) return { tone: 'danger', pct: 20, label: 'Overdue' };

  const last = lastActivityTimestamp(deal);
  const daysSinceActivity = last ? (Date.now() - last) / (24 * 60 * 60 * 1000) : Infinity;
  if (daysSinceActivity >= 14) return { tone: 'danger', pct: 30, label: 'Stalled' };
  if (daysSinceActivity >= 7) return { tone: 'amber', pct: 60, label: 'Slowing' };
  return { tone: 'green', pct: 90, label: 'Active' };
}

function renderDealRow(deal) {
  const relDot = relationshipDot(deal.relationshipStatus);
  const needsAttention = dealNeedsAttention(deal);
  const health = dealHealthTier(deal);

  const metaParts = [];
  if (deal.entityType) metaParts.push('<span class="type-word type-word--' + deal.entityType + '">' + deal.entityType.charAt(0).toUpperCase() + deal.entityType.slice(1) + '</span>');
  if (deal.fieldOfWork) metaParts.push(escapeHtml(deal.fieldOfWork));
  if (deal.requirement) metaParts.push(escapeHtml(deal.requirement));
  const metaHtml = metaParts.length ? '<div class="deal-meta">' + metaParts.join(' <span class="meta-dot">·</span> ') + '</div>' : '';

  const recent = mostRecentUpdate(deal);
  const recentHtml = recent
    ? '<div class="deal-recent-update"><i class="bi bi-arrow-return-right"></i> ' + escapeHtml(relativeDayLabel(entryDateKey(recent)) || '') + ': ' + escapeHtml(recent.note || recent.action || recent.channel || 'Update') + '</div>'
    : '';

  const referralCell = (deal.referral && deal.referral.name)
    ? '<button type="button" class="referral-chip" data-referral="' + escapeHtml(deal.referral.name) + '" title="' + escapeHtml(deal.referral.name) + '">' +
        '<i class="bi bi-arrow-up-right-circle"></i><span class="referral-chip__label">' + escapeHtml(deal.referral.name) + '</span>' +
      '</button>'
    : '<span class="no-referral">—</span>';

  const overdue = isOverdue(deal);
  const closeLabel = deal.closeDate
    ? new Date(deal.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No close date';
  const lastActive = timeAgo(lastActivityTimestamp(deal));

  const invoiceCount = (deal.invoices || []).length;
  const linkedProject = (typeof getProjects === 'function' ? getProjects() : []).find(p => p.dealId === deal.id);

  return '' +
    '<tr class="row-new row-clickable" data-id="' + deal.id + '">' +
      '<td class="row-index">' + formatIndex(deal.entryIndex) + '</td>' +
      '<td class="deal-cell">' +
        '<div class="deal-cell__name-row">' +
          relDot +
          '<span class="deal-name">' + escapeHtml(deal.entityName || 'Untitled entity') + '</span>' +
          (needsAttention ? '<span class="deal-notify" title="Needs attention — see the Attention page"><i class="bi bi-bell-fill"></i></span>' : '') +
          linkedItemsBadgeHtml('deal', deal.id) +
        '</div>' +
        metaHtml +
        recentHtml +
      '</td>' +
      '<td class="value-payment-cell">' +
        '<div class="deal-value">' + formatDualCurrency(deal.value, deal.currency) + '</div>' +
        paymentCellHtml(deal) +
      '</td>' +
      '<td class="status-cell">' +
        '<span class="stage-badge stage-badge--' + deal.stage + '">' + deal.stage + '</span>' +
        workStatusBadge(deal.workStatus) +
        (health ? '<div class="deal-health" title="' + health.label + '"><div class="deal-health__fill deal-health__fill--' + health.tone + '" style="width:' + health.pct + '%"></div></div>' : '') +
      '</td>' +
      '<td>' + referralCell + '</td>' +
      '<td class="timeline-cell">' +
        '<div class="' + (overdue ? 'close-date--overdue' : 'close-date') + '">' + (overdue ? '<i class="bi bi-exclamation-circle-fill"></i> ' : '') + closeLabel + '</div>' +
        '<div class="last-activity">' + (lastActive ? '<i class="bi bi-clock-history"></i> ' + lastActive : 'No activity yet') + '</div>' +
      '</td>' +
      '<td>' +
        '<div class="dropdown row-actions-menu">' +
          '<button type="button" class="actions-btn" data-bs-toggle="dropdown" aria-expanded="false" title="Actions" aria-label="Deal actions">' +
            '<i class="bi bi-three-dots"></i>' +
          '</button>' +
          '<ul class="dropdown-menu dropdown-menu-end">' +
            '<li><button type="button" class="dropdown-item" data-action="view"><i class="bi bi-eye"></i>View details</button></li>' +
            '<li><button type="button" class="dropdown-item" data-action="edit"><i class="bi bi-pencil"></i>Edit deal</button></li>' +
            '<li><button type="button" class="dropdown-item" data-action="update"><i class="bi bi-chat-square-text"></i>Add update</button></li>' +
            '<li><hr class="dropdown-divider"></li>' +
            '<li><button type="button" class="dropdown-item" data-action="new-invoice"><i class="bi bi-receipt"></i>Create invoice</button></li>' +
            (invoiceCount ? '<li><button type="button" class="dropdown-item" data-action="view-invoices"><i class="bi bi-receipt-cutoff"></i>View invoices (' + invoiceCount + ')</button></li>' : '') +
            '<li><hr class="dropdown-divider"></li>' +
            (linkedProject
              ? '<li><button type="button" class="dropdown-item" data-action="open-project"><i class="bi bi-kanban"></i>Open project</button></li>'
              : '<li><button type="button" class="dropdown-item" data-action="convert-project"><i class="bi bi-arrow-right-circle"></i>Convert to project</button></li>') +
            '<li><hr class="dropdown-divider"></li>' +
            '<li><button type="button" class="dropdown-item text-danger" data-action="delete"><i class="bi bi-trash3"></i>Delete deal</button></li>' +
          '</ul>' +
        '</div>' +
      '</td>' +
    '</tr>';
}

function renderDeals() {
  const allDeals = getDeals();
  updateTotals(allDeals);
  renderPipelineFunnel(allDeals);
  updateSortHeaderUI();
  renderActiveFilterBanner();

  const dealsViewEl = document.getElementById('dealsView');
  if (dealsViewEl && !dealsViewEl.classList.contains('d-none')) {
    renderDealsAnalytics(allDeals);
  }

  const visibleDeals = getFilteredSortedDeals();

  if (allDeals.length === 0) {
    dealsTableBody.innerHTML = '';
    dealsEmptyState.classList.remove('d-none');
    dealsNoResultsState.classList.add('d-none');
    return;
  }
  dealsEmptyState.classList.add('d-none');

  if (visibleDeals.length === 0) {
    dealsTableBody.innerHTML = '';
    dealsNoResultsState.classList.remove('d-none');
    return;
  }
  dealsNoResultsState.classList.add('d-none');
  dealsTableBody.innerHTML = visibleDeals.map(renderDealRow).join('');
  initRowActionDropdowns();
}

// The table wrapper needs overflow:hidden for its rounded corners, and the
// table-responsive wrapper needs overflow-x:auto to scroll — both would
// clip a normally-positioned dropdown menu. Popper's "fixed" strategy
// positions the menu relative to the viewport instead of either ancestor,
// which is the standard fix (not a z-index problem — z-index can't win
// against an ancestor's overflow clipping).
//
// IMPORTANT: popperConfig must be passed as a FUNCTION, not a plain object.
// Bootstrap's dropdown replaces its entire default Popper config (offset,
// flip, preventOverflow modifiers and all) with whatever you pass as an
// object — leaving nothing but strategy:'fixed' strips out the modifiers
// that actually position/size the menu, so it renders in the wrong spot
// (often directly under the pointer or off-element) and clicks on it never
// land on a menu item. The function form receives Bootstrap's own default
// config so it can be merged instead of clobbered.
function initRowActionDropdowns() {
  dealsTableBody.querySelectorAll('.actions-btn').forEach(btn => {
    if (!bootstrap.Dropdown.getInstance(btn)) {
      new bootstrap.Dropdown(btn, {
        popperConfig: (defaultBsPopperConfig) => Object.assign({}, defaultBsPopperConfig, { strategy: 'fixed' }),
      });
    }
  });
}

// ---------- Row / toolbar interactions ----------
dealsTableBody.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.closest('.linked-badge')) return; // handled by related.js's document-level listener

  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    if (action === 'view' || action === 'view-invoices') openDetailModal(id);
    else if (action === 'edit') openWizard(id);
    else if (action === 'update') openQuickUpdateModal(id);
    else if (action === 'new-invoice') openInvoiceEditor(id);
    else if (action === 'convert-project') convertDealToProject(id);
    else if (action === 'open-project') {
      const project = (typeof getProjects === 'function' ? getProjects() : []).find(p => p.dealId === id);
      if (project) { switchView('projects'); openProjectModal(project.id); }
    }
    else if (action === 'delete') confirmDelete(id);
    return;
  }

  if (e.target.closest('.referral-chip')) {
    const name = e.target.closest('.referral-chip').dataset.referral;
    switchView('referrals', { searchTerm: name });
  } else if (e.target.closest('.row-actions-menu')) {
    // clicks on the dropdown toggle itself (before a menu item is chosen) —
    // do nothing here; Bootstrap's own delegated handler opens the menu.
  } else {
    openDetailModal(id);
  }
});

let dealsSearchDebounce;
dealsSearchInput.addEventListener('input', (e) => {
  clearTimeout(dealsSearchDebounce);
  dealsSearchDebounce = setTimeout(() => { dealsSearchTerm = e.target.value; renderDeals(); }, 150);
});

// Called by app.js's tab switcher to jump into the Deals tab pre-filtered.
function setDealsSearch(term) {
  dealsSearchTerm = term;
  dealsSearchInput.value = term;
  activeStageFilter = 'all';
  activeMoneyFilter = null;
  renderDeals();
}
