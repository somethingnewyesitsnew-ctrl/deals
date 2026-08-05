/* ============================================================
   app.js
   ------------------------------------------------------------
   Smallest file, loaded last. Wires up the tab bar, the shared
   toast, and calls each module's render function on startup.
   switchView() is the one thing every other module calls to
   jump tabs (optionally pre-filtered by a search term).
   ============================================================ */

const viewTabs = document.getElementById('viewTabs');
const VIEWS = ['today', 'deals', 'attention', 'calendar', 'referrals', 'contacts', 'entities', 'financial', 'overview'];

const toastEl = document.getElementById('appToast');
const toastBody = document.getElementById('appToastBody');
const toast = new bootstrap.Toast(toastEl, { delay: 2200 });

function showToast(message) {
  toastBody.textContent = message;
  toast.show();
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

  if (view === 'deals' && options.searchTerm !== undefined) setDealsSearch(options.searchTerm);
  if (view === 'deals') renderDealsAnalytics(getDeals());
  if (view === 'referrals' && options.searchTerm !== undefined) setReferralSearch(options.searchTerm);
  if (view === 'contacts' && options.searchTerm !== undefined) setContactSearch(options.searchTerm);
  if (view === 'entities' && options.searchTerm !== undefined) setEntitySearch(options.searchTerm);
  if (view === 'calendar') renderCalendar();
  if (view === 'financial') renderFinancial();
  if (view === 'overview') renderCharts();
}

viewTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.view-tab');
  if (!tab) return;
  switchView(tab.dataset.view);
});

function updateTabCounts() {
  const deals = getDeals();
  document.getElementById('tabCountDeals').textContent = deals.length;
  const todayCount = buildTodaySections().todayItems.length;
  const todayBadge = document.getElementById('tabCountToday');
  todayBadge.textContent = todayCount;
  todayBadge.classList.toggle('has-items', todayCount > 0);

  const attentionCount = getAttentionCounts();
  const attentionBadge = document.getElementById('tabCountAttention');
  attentionBadge.textContent = attentionCount;
  attentionBadge.classList.toggle('has-items', attentionCount > 0);

  document.getElementById('tabCountReferrals').textContent = buildReferralGroups().length;
  document.getElementById('tabCountContacts').textContent = buildContactGroups().length;
  document.getElementById('tabCountEntities').textContent = buildEntityGroups().length;
  document.getElementById('tabCountFinancial').textContent = getAllInvoicesFlat().length;
}

// Re-render every tab's data. Cheap at this data scale and avoids stale
// Referrals/Contacts/Entities/Charts after a deal is saved or deleted.
function renderEverything() {
  renderToday();
  renderDeals();
  renderAttention();
  renderReferrals();
  renderContacts();
  renderEntities();
  updateTabCounts();
  const calendarViewEl = document.getElementById('calendarView');
  if (calendarViewEl && !calendarViewEl.classList.contains('d-none')) {
    renderCalendar();
  }
  const financialViewEl = document.getElementById('financialView');
  if (financialViewEl) {
    renderFinancial(); // stats/tables always refresh; the chart itself only renders if visible (see renderFinancial)
  }
  if (document.getElementById('overviewView') && !document.getElementById('overviewView').classList.contains('d-none')) {
    renderCharts();
  }
}

// ---------- Theme (light / dark) ----------
const THEME_KEY = 'deal-ledger:theme';
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeToggleIcon = document.getElementById('themeToggleIcon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-bs-theme', theme);
  themeToggleIcon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
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
refreshAllDatalists();
refreshExchangeRateLabel();
recordTodaysSnapshotIfNeeded(getDeals());
renderEverything();

const fabNewDealBtn = document.getElementById('fabNewDealBtn');
if (fabNewDealBtn) fabNewDealBtn.addEventListener('click', () => openWizard());
