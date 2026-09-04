/* ============================================================
   app.js
   ------------------------------------------------------------
   Smallest file, loaded last. Wires up the tab bar, the shared
   toast, and calls each module's render function on startup.
   switchView() is the one thing every other module calls to
   jump tabs (optionally pre-filtered by a search term).

   Startup now awaits initStorage() (see storage.js) once before
   doing anything else, since deals/expenses/options/settings come
   from Supabase instead of localStorage — everything after that
   first await is unchanged from before.
   ============================================================ */

const viewTabs = document.getElementById('viewTabs');
const VIEWS = ['today', 'todos', 'documentation', 'deals', 'projects', 'attention', 'calendar', 'referrals', 'contacts', 'entities', 'financial', 'debts', 'overview'];
const VIEW_LABELS = {
  today: 'Dashboard', todos: 'To-Do', documentation: 'Archive', deals: 'Deals', projects: 'Projects', attention: 'Attention', calendar: 'Calendar',
  referrals: 'Referrals', contacts: 'Contacts', entities: 'Entities', financial: 'Financials', debts: 'Debts', overview: 'Reports',
};

const toastEl = document.getElementById('appToast');
const toastBody = document.getElementById('appToastBody');
const toast = new bootstrap.Toast(toastEl, { delay: 2200 });

function showToast(message) {
  toastBody.textContent = message;
  toast.show();
}

// ---------- Lazy / dirty-view rendering ----------
// Almost every save touches data that potentially affects every tab (a
// new deal changes Deals, Attention, Today, Referrals, Contacts, Entities,
// and every chart at once) — but the person is only ever looking at ONE
// of those 9 tabs at a time. Re-painting all 9 (several of them full
// ApexCharts rebuilds) on every single keystroke-triggered save was pure
// waste for the 8 tabs not on screen. Now a save just marks every view
// "dirty"; only the currently-visible view actually re-renders right
// away, and the rest catch up the moment the person switches to them.
const VIEW_RENDERERS = {
  today: renderToday,
  todos: renderTodos,
  documentation: renderDocumentation,
  deals: renderDeals,
  projects: renderProjects,
  attention: renderAttention,
  calendar: renderCalendar,
  referrals: renderReferrals,
  contacts: renderContacts,
  entities: renderEntities,
  financial: renderFinancial,
  debts: renderDebts,
  overview: renderCharts,
};

let _dirtyViews = new Set(VIEWS);

function _currentActiveView() {
  const tab = viewTabs.querySelector('.view-tab.is-active');
  return tab ? tab.dataset.view : VIEWS[0];
}

function _renderViewNow(view) {
  const fn = VIEW_RENDERERS[view];
  if (fn) fn();
  _dirtyViews.delete(view);
}

function _renderViewIfDirty(view) {
  if (_dirtyViews.has(view)) _renderViewNow(view);
}

function switchView(view, options) {
  options = options || {};

  viewTabs.querySelectorAll('.view-tab').forEach(t => {
    t.classList.toggle('is-active', t.dataset.view === view);
  });
  VIEWS.forEach(v => {
    const section = document.getElementById(v + 'View');
    if (section) section.classList.toggle('d-none', v !== view);
  });

  const crumb = document.getElementById('titlebarCrumb');
  if (crumb) crumb.textContent = VIEW_LABELS[view] || 'Deal Ledger';

  const sidebarEl = document.getElementById('winSidebar');
  if (sidebarEl && window.matchMedia('(max-width: 900px)').matches) {
    sidebarEl.classList.remove('is-open');
  }

  // A search-jump (e.g. clicking a referral chip) needs the target view's
  // own setXSearch() — that already renders internally, so just mark clean.
  if (view === 'deals' && options.searchTerm !== undefined) { setDealsSearch(options.searchTerm); _dirtyViews.delete('deals'); }
  else if (view === 'referrals' && options.searchTerm !== undefined) { setReferralSearch(options.searchTerm); _dirtyViews.delete('referrals'); }
  else if (view === 'contacts' && options.searchTerm !== undefined) { setContactSearch(options.searchTerm); _dirtyViews.delete('contacts'); }
  else if (view === 'entities' && options.searchTerm !== undefined) { setEntitySearch(options.searchTerm); _dirtyViews.delete('entities'); }
  else { _renderViewIfDirty(view); }
}

viewTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.view-tab');
  if (!tab) return;
  switchView(tab.dataset.view);
});

function updateTabCounts() {
  const deals = getDeals();
  document.getElementById('tabCountDeals').textContent = deals.length;
  document.getElementById('tabCountProjects').textContent = getProjects().length;
  const todayCount = buildTodaySections().todayItems.length;
  const todayBadge = document.getElementById('tabCountToday');
  todayBadge.textContent = todayCount;
  todayBadge.classList.toggle('has-items', todayCount > 0);

  const attentionCount = getAttentionCounts();
  const attentionBadge = document.getElementById('tabCountAttention');
  attentionBadge.textContent = attentionCount;
  attentionBadge.classList.toggle('has-items', attentionCount > 0);

  const _now = new Date();
  const _todayKey = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
  const todosDueCount = getTodos().filter(t => t.status === 'open' && t.dueDate && t.dueDate <= _todayKey).length;
  const todosBadge = document.getElementById('tabCountTodos');
  todosBadge.textContent = todosDueCount;
  todosBadge.classList.toggle('has-items', todosDueCount > 0);

  document.getElementById('tabCountReferrals').textContent = buildReferralGroups().length;
  document.getElementById('tabCountContacts').textContent = buildContactGroups().length;
  document.getElementById('tabCountEntities').textContent = buildEntityGroups().length;
  document.getElementById('tabCountFinancial').textContent = getAllInvoicesFlat().length;

  const debtsOpenCount = getDebts().filter(d => d.status === 'open').length;
  const debtsBadge = document.getElementById('tabCountDebts');
  debtsBadge.textContent = debtsOpenCount;
  debtsBadge.classList.toggle('has-items', debtsOpenCount > 0);

  document.getElementById('tabCountDocumentation').textContent = getTodos().filter(t => t.status === 'done').length;
}

// Called after any save/delete/realtime update. Refreshes the tab counts
// (cheap — pure counting, no DOM table/chart rebuilds) immediately, fully
// re-renders whichever tab is actually on screen right now, and marks
// every other tab dirty so it renders fresh the moment it's opened —
// never stale, never wasted on tabs nobody's looking at.
function renderEverything() {
  VIEWS.forEach(v => _dirtyViews.add(v));
  updateTabCounts();
  _renderViewNow(_currentActiveView());
}

// ---------- Theme (light / dark) ----------
// Still a plain device-local preference — no reason to sync a screen color
// choice across devices through the database, so this one thing keeps
// using localStorage exactly as before.
const THEME_KEY = 'deal-ledger:theme';
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeToggleIcon = document.getElementById('themeToggleIcon');
const themeToggleLabel = document.getElementById('themeToggleLabel');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-bs-theme', theme);
  themeToggleIcon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
  if (themeToggleLabel) themeToggleLabel.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  try { localStorage.setItem(THEME_KEY, theme); } catch (err) {}
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
  const overviewView = document.getElementById('overviewView');
  if (overviewView && !overviewView.classList.contains('d-none')) renderCharts();
  const dealsViewEl = document.getElementById('dealsView');
  if (dealsViewEl && !dealsViewEl.classList.contains('d-none')) renderDealsAnalytics(getDeals());
  const financialViewEl = document.getElementById('financialView');
  if (financialViewEl && !financialViewEl.classList.contains('d-none')) renderIncomeExpenseChart();
});

// Sync the icon to whatever the pre-paint script in <head> already set.
applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

// ---------- Sidebar collapse (desktop) + flyout open (mobile) ----------
const SIDEBAR_KEY = 'deal-ledger:sidebar-collapsed';
const winSidebar = document.getElementById('winSidebar');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const sidebarCollapseIcon = document.getElementById('sidebarCollapseIcon');
const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');

function applySidebarCollapsed(collapsed) {
  winSidebar.classList.toggle('is-collapsed', collapsed);
  sidebarCollapseIcon.className = collapsed ? 'bi bi-layout-sidebar' : 'bi bi-layout-sidebar-inset';
  sidebarCollapseBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (err) {}
}

sidebarCollapseBtn.addEventListener('click', () => {
  applySidebarCollapsed(!winSidebar.classList.contains('is-collapsed'));
});

try {
  if (localStorage.getItem(SIDEBAR_KEY) === '1' && !window.matchMedia('(max-width: 900px)').matches) {
    applySidebarCollapsed(true);
  }
} catch (err) {}

function syncMobileSidebarChrome() {
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  sidebarOpenBtn.classList.toggle('d-none', !isMobile);
  if (!isMobile) winSidebar.classList.remove('is-open');
}
syncMobileSidebarChrome();
window.addEventListener('resize', syncMobileSidebarChrome);

sidebarOpenBtn.addEventListener('click', () => winSidebar.classList.toggle('is-open'));

document.addEventListener('click', (e) => {
  if (!window.matchMedia('(max-width: 900px)').matches) return;
  if (winSidebar.classList.contains('is-open') && !e.target.closest('#winSidebar') && !e.target.closest('#sidebarOpenBtn')) {
    winSidebar.classList.remove('is-open');
  }
});

// ---------- FAB speed-dial (the app-wide "add new" entry point) ----------
const fabSpeedDial = document.getElementById('fabSpeedDial');
const fabMainBtn = document.getElementById('fabMainBtn');
const fabMainIcon = document.getElementById('fabMainIcon');

function closeFabSpeedDial() {
  fabSpeedDial.classList.remove('is-open');
  fabMainBtn.setAttribute('aria-expanded', 'false');
  fabMainIcon.className = 'bi bi-plus-lg';
}
function openFabSpeedDial() {
  fabSpeedDial.classList.add('is-open');
  fabMainBtn.setAttribute('aria-expanded', 'true');
  fabMainIcon.className = 'bi bi-x-lg';
}

fabMainBtn.addEventListener('click', () => {
  if (fabSpeedDial.classList.contains('is-open')) closeFabSpeedDial();
  else openFabSpeedDial();
});

document.addEventListener('click', (e) => {
  if (fabSpeedDial.classList.contains('is-open') && !e.target.closest('#fabSpeedDial')) closeFabSpeedDial();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFabSpeedDial();
});

// ---------- Currency settings ----------
const exchangeRateBtn = document.getElementById('exchangeRateBtn');
const exchangeRateLabel = document.getElementById('exchangeRateLabel');
const exchangeRateInput = document.getElementById('exchangeRateInput');
const saveExchangeRateBtn = document.getElementById('saveExchangeRateBtn');
const settingsModal = new bootstrap.Modal(document.getElementById('settingsModal'));

function refreshExchangeRateLabel() {
  exchangeRateLabel.textContent = '1 USD = ' + sdgFormatter.format(getExchangeRate()) + ' SDG';
}

exchangeRateBtn.addEventListener('click', () => {
  exchangeRateInput.value = getExchangeRate();
  settingsModal.show();
});

saveExchangeRateBtn.addEventListener('click', () => {
  const rate = Number(exchangeRateInput.value);
  if (!(rate > 0)) {
    exchangeRateInput.focus();
    return;
  }
  setExchangeRate(rate);
  refreshExchangeRateLabel();
  settingsModal.hide();
  renderEverything();
  showToast('Exchange rate updated — every conversion refreshed.');
});

// ---------- Init ----------
// initStorage() (storage.js) is the one async step in this whole app —
// it loads deals/expenses/contact-updates/options/settings/snapshots from
// Supabase into an in-memory cache. Everything below only runs after that
// resolves, so every other file's getDeals()/getOptions()/etc. calls stay
// perfectly synchronous.
const dbLoadingOverlay = document.getElementById('dbLoadingOverlay');
const dbLoadingMessage = document.getElementById('dbLoadingMessage');
const dbLoadingRetryBtn = document.getElementById('dbLoadingRetryBtn');

function hideLoadingOverlay() {
  if (dbLoadingOverlay) dbLoadingOverlay.classList.add('d-none');
}

function showLoadingError(message) {
  if (!dbLoadingOverlay) { console.error(message); return; }
  dbLoadingOverlay.classList.remove('d-none');
  dbLoadingOverlay.classList.add('db-loading-overlay--error');
  if (dbLoadingMessage) dbLoadingMessage.textContent = message;
  if (dbLoadingRetryBtn) dbLoadingRetryBtn.classList.remove('d-none');
}

async function boot() {
  await initStorage();

  if (!dbReady) {
    showLoadingError(dbInitError || 'Could not connect to the database.');
    return;
  }

  hideLoadingOverlay();
  refreshAllDatalists();
  refreshExchangeRateLabel();
  recordTodaysSnapshotIfNeeded(getDeals());
  renderEverything();

  const fabAddDealBtn = document.getElementById('fabAddDealBtn');
  if (fabAddDealBtn) fabAddDealBtn.addEventListener('click', () => { closeFabSpeedDial(); openWizard(); });

  const fabAddTaskBtn = document.getElementById('fabAddTaskBtn');
  if (fabAddTaskBtn) fabAddTaskBtn.addEventListener('click', () => { closeFabSpeedDial(); openNewTodoModal(); });

  const fabAddExpenseBtn = document.getElementById('fabAddExpenseBtn');
  if (fabAddExpenseBtn) fabAddExpenseBtn.addEventListener('click', () => { closeFabSpeedDial(); openExpenseModal(); });

  const fabAddDebtBtn = document.getElementById('fabAddDebtBtn');
  if (fabAddDebtBtn) fabAddDebtBtn.addEventListener('click', () => { closeFabSpeedDial(); openNewDebtModal(); });

  const fabAddProjectBtn = document.getElementById('fabAddProjectBtn');
  if (fabAddProjectBtn) fabAddProjectBtn.addEventListener('click', () => { closeFabSpeedDial(); openNewProjectModal(); });

  const exportDataBtn = document.getElementById('exportDataBtn');
  if (exportDataBtn) {
    exportDataBtn.addEventListener('click', () => {
      downloadFullBackup();
      showToast('Backup downloaded.');
    });
  }
}

if (dbLoadingRetryBtn) {
  dbLoadingRetryBtn.addEventListener('click', () => {
    dbLoadingOverlay.classList.remove('db-loading-overlay--error');
    dbLoadingRetryBtn.classList.add('d-none');
    if (dbLoadingMessage) dbLoadingMessage.textContent = 'Connecting…';
    boot();
  });
}

boot();
