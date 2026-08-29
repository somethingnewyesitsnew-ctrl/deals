/* ============================================================
   financial.js
   ------------------------------------------------------------
   The Financial tab — a single place for money across the whole
   business: every invoice across every deal, expenses (a new
   top-level entity, see storage.js's getExpenses/saveExpense/
   deleteExpense), and a summary + income-vs-expense chart.

   Invoices are still created/edited from invoices.js (inside a
   deal's detail view) — this tab is a read + status-management
   surface across all of them at once, not a second invoice editor.

   Depends on: storage.js, invoices.js (invoiceTotal, formatInvoiceAmount,
   INVOICE_STATUS_LABELS, openInvoicePrintView), charts.js (monthKey,
   monthLabel, chartBase, isDarkTheme), deals-detail.js (openDetailModal),
   app.js (switchView).

   Exposes: renderFinancial()
   ============================================================ */

// ---------- DOM refs ----------
const financialStatsGrid = document.getElementById('financialStatsGrid');
const financialInvoicesTableBody = document.getElementById('financialInvoicesTableBody');
const financialInvoicesEmptyState = document.getElementById('financialInvoicesEmptyState');
const financialInvoiceSearchInput = document.getElementById('financialInvoiceSearchInput');
const expensesTableBody = document.getElementById('expensesTableBody');
const expensesEmptyState = document.getElementById('expensesEmptyState');

let incomeExpenseChartInstance = null;
let financialInvoiceSearchTerm = '';

// ---------- Data helpers ----------
function getAllInvoicesFlat() {
  const out = [];
  getDeals().forEach(deal => {
    (deal.invoices || []).forEach(inv => out.push({ deal, invoice: inv }));
  });
  return out.sort((a, b) => (b.invoice.createdAt || 0) - (a.invoice.createdAt || 0));
}

function computeFinancialStats() {
  const flat = getAllInvoicesFlat();
  let invoicedUSD = 0, collectedUSD = 0;
  flat.forEach(({ invoice }) => {
    const amt = toUSD(invoiceTotal(invoice.items), invoice.currency);
    invoicedUSD += amt;
    if (invoice.status === 'paid') collectedUSD += amt;
  });
  const outstandingUSD = Math.max(0, invoicedUSD - collectedUSD);
  const expensesUSD = getExpenses().filter(e => e.kind !== 'income').reduce((s, e) => s + toUSD(e.amount, e.currency), 0);
  const otherIncomeUSD = getExpenses().filter(e => e.kind === 'income').reduce((s, e) => s + toUSD(e.amount, e.currency), 0);
  const netUSD = collectedUSD + otherIncomeUSD - expensesUSD;
  return { invoicedUSD, collectedUSD, outstandingUSD, expensesUSD, otherIncomeUSD, netUSD };
}

// ---------- Summary stats ----------
function renderFinancialStats() {
  if (!financialStatsGrid) return;
  const s = computeFinancialStats();
  financialStatsGrid.innerHTML = [
    { label: 'Total invoiced', value: formatUSD(s.invoicedUSD), icon: 'bi-receipt', tone: 'slate', kind: null },
    { label: 'Collected (income)', value: formatUSD(s.collectedUSD), icon: 'bi-cash-stack', tone: 'green', kind: 'collected' },
    { label: 'Outstanding', value: formatUSD(s.outstandingUSD), icon: 'bi-exclamation-diamond', tone: s.outstandingUSD > 0.01 ? 'amber' : 'slate', kind: 'outstanding' },
    { label: 'Other income', value: formatUSD(s.otherIncomeUSD), icon: 'bi-plus-circle', tone: s.otherIncomeUSD > 0 ? 'green' : 'slate', kind: null },
    { label: 'Expenses', value: formatUSD(s.expensesUSD), icon: 'bi-wallet2', tone: s.expensesUSD > 0 ? 'danger' : 'slate', kind: null },
    { label: 'Net profit', value: formatUSD(s.netUSD), icon: 'bi-piggy-bank', tone: s.netUSD >= 0 ? 'green' : 'danger', kind: null },
  ].map(c => {
    const tag = c.kind ? 'button' : 'div';
    return '<' + tag + (c.kind ? ' type="button" data-stat-kind="' + c.kind + '"' : '') +
      ' class="attention-stat attention-stat--' + c.tone + (c.kind ? ' attention-stat--clickable' : '') + '">' +
      '<i class="bi ' + c.icon + '"></i>' +
      '<span class="attention-stat__figure mono-figure">' + c.value + '</span>' +
      '<span class="attention-stat__label">' + c.label + '</span>' +
    '</' + tag + '>';
  }).join('');
}

financialStatsGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-stat-kind]');
  if (!btn) return;
  openInvoiceStatusList(btn.dataset.statKind);
});

// ---------- Income vs expenses chart ----------
function renderIncomeExpenseChart() {
  const el = document.getElementById('incomeExpenseChart');
  if (!el) return;

  const incomeByMonth = new Map();
  getAllInvoicesFlat().forEach(({ invoice }) => {
    if (invoice.status !== 'paid' || !invoice.date) return;
    const key = monthKey(new Date(invoice.date).getTime());
    incomeByMonth.set(key, (incomeByMonth.get(key) || 0) + toUSD(invoiceTotal(invoice.items), invoice.currency));
  });
  const expenseByMonth = new Map();
  getExpenses().forEach(exp => {
    if (!exp.date) return;
    const key = monthKey(new Date(exp.date).getTime());
    const usd = toUSD(exp.amount, exp.currency);
    if (exp.kind === 'income') {
      incomeByMonth.set(key, (incomeByMonth.get(key) || 0) + usd);
    } else {
      expenseByMonth.set(key, (expenseByMonth.get(key) || 0) + usd);
    }
  });

  const keys = Array.from(new Set([...incomeByMonth.keys(), ...expenseByMonth.keys()])).sort();
  const last = keys.slice(-9);

  if (last.length === 0) {
    el.innerHTML = '<p class="chart-empty">No paid invoices or expenses recorded yet.</p>';
    return;
  }
  el.innerHTML = '';

  const base = chartBase();
  const options = Object.assign({}, base, {
    series: [
      { name: 'Income', data: last.map(k => Math.round(incomeByMonth.get(k) || 0)) },
      { name: 'Expenses', data: last.map(k => Math.round(expenseByMonth.get(k) || 0)) },
    ],
    chart: Object.assign({}, base.chart, { type: 'bar', height: 220 }),
    plotOptions: { bar: { borderRadius: 4, columnWidth: '55%' } },
    xaxis: { categories: last.map(monthLabel), labels: { style: { colors: '#94A0B8' } } },
    yaxis: { labels: { style: { colors: '#94A0B8' }, formatter: (v) => formatUSD(v) } },
    colors: ['#0F7B0F', '#C42B1C'],
    legend: { position: 'top', fontSize: '11px', labels: { colors: isDarkTheme() ? '#96A0B5' : '#5B6478' } },
    dataLabels: { enabled: false },
  });

  if (incomeExpenseChartInstance) incomeExpenseChartInstance.destroy();
  incomeExpenseChartInstance = new ApexCharts(el, options);
  incomeExpenseChartInstance.render();
}

// ---------- Invoices table (global, across every deal) ----------
function renderFinancialInvoicesTable() {
  let flat = getAllInvoicesFlat();

  if (financialInvoiceSearchTerm.trim()) {
    const term = financialInvoiceSearchTerm.trim().toLowerCase();
    flat = flat.filter(({ deal, invoice }) =>
      (invoice.number || '').toLowerCase().includes(term) ||
      (deal.entityName || '').toLowerCase().includes(term)
    );
  }

  if (flat.length === 0) {
    financialInvoicesTableBody.innerHTML = '';
    financialInvoicesEmptyState.classList.remove('d-none');
    return;
  }
  financialInvoicesEmptyState.classList.add('d-none');

  financialInvoicesTableBody.innerHTML = flat.map(({ deal, invoice }) => {
    const total = invoiceTotal(invoice.items);
    const statusTone = invoice.status === 'paid' ? 'done' : invoice.status === 'sent' ? 'scheduled' : 'note';
    return '' +
      '<tr class="row-clickable" data-deal="' + deal.id + '">' +
        '<td><span class="deal-name">' + escapeHtml(invoice.number) + '</span></td>' +
        '<td>' + escapeHtml(deal.entityName || 'Untitled entity') + '</td>' +
        '<td class="text-end deal-value">' + formatInvoiceAmount(total, invoice.currency) + '</td>' +
        '<td><span class="status-badge status-badge--' + statusTone + '">' + (INVOICE_STATUS_LABELS[invoice.status] || 'Draft') + '</span></td>' +
        '<td>' + (invoice.date || '<span class="no-referral">—</span>') + '</td>' +
        '<td>' + (invoice.dueDate || '<span class="no-referral">—</span>') + '</td>' +
        '<td class="d-flex gap-1">' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" data-open-invoice="' + invoice.id + '" data-open-deal="' + deal.id + '">View</button>' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" data-delete-invoice="' + invoice.id + '" data-delete-deal="' + deal.id + '" title="Delete"><i class="bi bi-trash3"></i></button>' +
        '</td>' +
      '</tr>';
  }).join('');
}

financialInvoicesTableBody.addEventListener('click', (e) => {
  const viewBtn = e.target.closest('[data-open-invoice]');
  if (viewBtn) { openInvoicePrintView(viewBtn.dataset.openDeal, viewBtn.dataset.openInvoice); return; }
  const deleteBtn = e.target.closest('[data-delete-invoice]');
  if (deleteBtn) { deleteInvoiceRecord(deleteBtn.dataset.deleteDeal, deleteBtn.dataset.deleteInvoice); return; }
  const row = e.target.closest('tr[data-deal]');
  if (row) { switchView('deals'); openDetailModal(row.dataset.deal); }
});

let financialInvoiceSearchDebounce;
financialInvoiceSearchInput.addEventListener('input', (e) => {
  clearTimeout(financialInvoiceSearchDebounce);
  financialInvoiceSearchDebounce = setTimeout(() => { financialInvoiceSearchTerm = e.target.value; renderFinancialInvoicesTable(); }, 150);
});

// ---------- Expenses table + modal ----------
const expenseModalEl = document.getElementById('expenseModal');
const expenseModal = new bootstrap.Modal(expenseModalEl);
const expenseModalTitle = document.getElementById('expenseModalTitle');
const expenseIdInput = document.getElementById('expenseId');
const expenseDescriptionInput = document.getElementById('expenseDescription');
const expenseCategoryInput = document.getElementById('expenseCategory');
const expenseCategoryLabel = document.getElementById('expenseCategoryLabel');
const expenseCategoryHint = document.getElementById('expenseCategoryHint');
const expenseDateInput = document.getElementById('expenseDate');
const expenseAmountInput = document.getElementById('expenseAmount');
const expenseRecurringInput = document.getElementById('expenseRecurring');
const saveExpenseBtn = document.getElementById('saveExpenseBtn');
const expenseDeleteBtn = document.getElementById('expenseDeleteBtn');

const expenseLinkPicker = createLinkPicker({
  container: document.getElementById('expenseLinkPickerContainer'),
  chipsEl: document.getElementById('expenseLinkChips'),
});

// The Category field doubles as "Source" for income rows — same underlying
// column, just a different label/datalist/placeholder so it reads right.
function syncExpenseCategoryFieldToKind() {
  const isIncome = document.getElementById('expenseKindIncome').checked;
  expenseCategoryLabel.textContent = isIncome ? 'Source' : 'Category';
  expenseCategoryInput.setAttribute('list', isIncome ? 'incomeSourceOptionsList' : 'expenseCategoryOptionsList');
  expenseCategoryInput.placeholder = isIncome ? 'Where this income came from…' : 'Select or type new…';
  expenseCategoryHint.textContent = isIncome ? 'Where the money came from — a deal, an external project, consulting, etc.' : 'What kind of expense this is.';
}
document.getElementById('expenseKindExpense').addEventListener('change', syncExpenseCategoryFieldToKind);
document.getElementById('expenseKindIncome').addEventListener('change', syncExpenseCategoryFieldToKind);

function openExpenseModal(expenseId) {
  const existing = expenseId ? getExpenses().find(e => e.id === expenseId) : null;

  if (existing) {
    expenseModalTitle.textContent = existing.kind === 'income' ? 'Edit income' : 'Edit expense';
    expenseIdInput.value = existing.id;
    expenseDescriptionInput.value = existing.description || '';
    expenseCategoryInput.value = existing.category || '';
    expenseDateInput.value = existing.date || '';
    expenseAmountInput.value = existing.amount || '';
    expenseRecurringInput.value = existing.recurring || '';
    document.getElementById(existing.currency === 'SDG' ? 'expenseCurrencySDG' : 'expenseCurrencyUSD').checked = true;
    document.getElementById(existing.kind === 'income' ? 'expenseKindIncome' : 'expenseKindExpense').checked = true;
    expenseDeleteBtn.classList.remove('d-none');
  } else {
    expenseModalTitle.textContent = 'Add expense';
    expenseIdInput.value = '';
    expenseDescriptionInput.value = '';
    expenseCategoryInput.value = '';
    expenseDateInput.value = new Date().toISOString().slice(0, 10);
    expenseAmountInput.value = '';
    expenseRecurringInput.value = '';
    document.getElementById('expenseCurrencyUSD').checked = true;
    document.getElementById('expenseKindExpense').checked = true;
    expenseDeleteBtn.classList.add('d-none');
  }
  syncExpenseCategoryFieldToKind();
  expenseLinkPicker.reset();
  expenseLinkPicker.setLinks(existing ? existing.links || (existing.dealId ? [{ type: 'deal', id: existing.dealId, label: (getDeals().find(d => d.id === existing.dealId) || {}).entityName || 'Deal' }] : []) : []);
  expenseModal.show();
}

saveExpenseBtn.addEventListener('click', () => {
  const description = expenseDescriptionInput.value.trim();
  const amount = Number(expenseAmountInput.value) || 0;
  if (!description || !amount) {
    showToast('Add a description and an amount first.');
    return;
  }
  const isIncome = document.getElementById('expenseKindIncome').checked;
  const category = expenseCategoryInput.value.trim();
  if (category) addOption(isIncome ? 'incomeSource' : 'expenseCategory', category);
  if (description) addOption('expenseDescription', description);
  refreshAllDatalists();

  const links = expenseLinkPicker.getLinks();
  const dealLink = links.find(l => l.type === 'deal');

  const wasEdit = Boolean(expenseIdInput.value);
  saveExpense({
    id: expenseIdInput.value || undefined,
    description,
    category,
    date: expenseDateInput.value,
    amount,
    currency: document.getElementById('expenseCurrencySDG').checked ? 'SDG' : 'USD',
    kind: isIncome ? 'income' : 'expense',
    recurring: expenseRecurringInput.value,
    dealId: dealLink ? dealLink.id : null,
    links,
  });

  expenseModal.hide();
  renderFinancial();
  updateTabCounts();
  showToast(wasEdit ? (isIncome ? 'Income updated.' : 'Expense updated.') : (isIncome ? 'Income recorded.' : 'Expense recorded.'));
});

expenseDeleteBtn.addEventListener('click', () => {
  const id = expenseIdInput.value;
  if (!id) return;
  deleteExpense(id);
  expenseModal.hide();
  renderFinancial();
  showToast('Entry deleted.');
});

function renderExpensesTable() {
  const expenses = getExpenses();
  if (expenses.length === 0) {
    expensesTableBody.innerHTML = '';
    expensesEmptyState.classList.remove('d-none');
    return;
  }
  expensesEmptyState.classList.add('d-none');

  const dealsById = new Map(getDeals().map(d => [d.id, d]));

  expensesTableBody.innerHTML = expenses.map(exp => {
    const isIncome = exp.kind === 'income';
    const links = (exp.links && exp.links.length) ? exp.links : (exp.dealId ? [{ type: 'deal', id: exp.dealId, label: (dealsById.get(exp.dealId) || {}).entityName || 'Deal' }] : []);
    const linkedHtml = links.length
      ? links.slice(0, 2).map((l, i) => {
          const meta = LINK_TYPE_META[l.type] || LINK_TYPE_META.custom;
          return '<button type="button" class="todo-row__link-chip" data-expense-link="' + exp.id + '" data-link-index="' + i + '"><i class="bi ' + meta.icon + '"></i>' + escapeHtml(l.label) + '</button>';
        }).join('') + (links.length > 2 ? '<span class="todo-row__link-chip todo-row__link-chip--more">+' + (links.length - 2) + '</span>' : '')
      : '<span class="no-referral">—</span>';

    return '' +
      '<tr class="row-clickable" data-id="' + exp.id + '">' +
        '<td><span class="deal-name" data-edit-expense="' + exp.id + '">' + escapeHtml(exp.description) + '</span>' +
          (exp.sourceTodoId ? ' <i class="bi bi-link-45deg" title="Linked from a to-do"></i>' : '') + '</td>' +
        '<td><span class="status-badge status-badge--' + (isIncome ? 'done' : 'canceled') + '">' + (isIncome ? 'Income' : 'Expense') + '</span></td>' +
        '<td>' + (exp.category ? escapeHtml(exp.category) : '<span class="no-referral">—</span>') + '</td>' +
        '<td><div class="deal-badges">' + linkedHtml + '</div></td>' +
        '<td class="text-end deal-value">' + formatInvoiceAmount(exp.amount, exp.currency) + '</td>' +
        '<td>' + (exp.date || '<span class="no-referral">—</span>') + (exp.recurring ? ' <span class="todo-row__recurring" title="Repeats ' + exp.recurring + '"><i class="bi bi-arrow-repeat"></i></span>' : '') + '</td>' +
        '<td><button type="button" class="btn btn-sm btn-outline-secondary" data-edit-expense="' + exp.id + '"><i class="bi bi-pencil"></i></button></td>' +
      '</tr>';
  }).join('');
}

expensesTableBody.addEventListener('click', (e) => {
  const linkBtn = e.target.closest('[data-expense-link]');
  if (linkBtn) {
    const exp = getExpenses().find(x => x.id === linkBtn.dataset.expenseLink);
    const links = exp && ((exp.links && exp.links.length) ? exp.links : (exp.dealId ? [{ type: 'deal', id: exp.dealId, label: '' }] : []));
    const link = links && links[Number(linkBtn.dataset.linkIndex)];
    if (link) openLinkDetails(link);
    return;
  }
  const btn = e.target.closest('[data-edit-expense]');
  if (btn) { openExpenseModal(btn.dataset.editExpense); return; }
  const row = e.target.closest('tr[data-id]');
  if (row) openExpenseModal(row.dataset.id);
});

// ---------- Invoice Status modal (Collected / Outstanding drill-down) ----------
const invoiceStatusModalEl = document.getElementById('invoiceStatusModal');
const invoiceStatusModal = new bootstrap.Modal(invoiceStatusModalEl);
const invoiceStatusModalTitle = document.getElementById('invoiceStatusModalTitle');
const invoiceStatusModalBody = document.getElementById('invoiceStatusModalBody');

function daysUntilDateStr(dateStr) {
  if (!dateStr) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  return (new Date(dateStr + 'T00:00:00') - new Date(new Date().toDateString())) / dayMs;
}

// Picks the best available channel to nudge a client about an outstanding
// invoice — email if we have one, WhatsApp (via their phone number) if not,
// or nothing if neither is on file. Never fabricates contact info.
function buildReminderLink(deal, invoice, amountLabel) {
  const fc = deal.firstContact || {};
  const message = 'Hi' + (fc.name ? ' ' + fc.name : '') + ', this is a friendly reminder that invoice ' +
    invoice.number + ' (' + amountLabel + ') for ' + (deal.entityName || 'your project') +
    ' is ' + (invoice.dueDate ? 'due ' + invoice.dueDate : 'still outstanding') + '. Thank you!';

  if (fc.email) {
    return {
      href: 'mailto:' + encodeURIComponent(fc.email) + '?subject=' + encodeURIComponent('Invoice ' + invoice.number + ' reminder') + '&body=' + encodeURIComponent(message),
      label: 'Email reminder', icon: 'bi-envelope',
    };
  }
  if (fc.number) {
    const digits = fc.number.replace(/[^\d]/g, '');
    if (digits) return { href: 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message), label: 'WhatsApp reminder', icon: 'bi-whatsapp' };
  }
  return null;
}

function buildInvoiceSuggestion(kind, invoice) {
  if (kind === 'collected') return { text: 'Collected — no action needed', tone: 'green' };

  const days = daysUntilDateStr(invoice.dueDate);
  if (days === null) return { text: 'No due date set — consider following up', tone: 'slate' };
  if (days < 0) return { text: Math.round(-days) + 'd overdue — send a reminder', tone: 'danger' };
  if (days <= 7) return { text: 'Due in ' + Math.round(days) + 'd — a reminder wouldn\'t hurt', tone: 'amber' };
  return { text: 'Due in ' + Math.round(days) + 'd', tone: 'slate' };
}

function renderInvoiceStatusList(kind) {
  const flat = getAllInvoicesFlat();
  let items;

  if (kind === 'collected') {
    items = flat.filter(({ invoice }) => invoice.status === 'paid');
    invoiceStatusModalTitle.textContent = 'Collected invoices (' + items.length + ')';
  } else {
    items = flat.filter(({ invoice }) => invoice.status !== 'paid' && invoiceTotal(invoice.items) > 0);
    items.sort((a, b) => {
      const da = daysUntilDateStr(a.invoice.dueDate);
      const db = daysUntilDateStr(b.invoice.dueDate);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
    invoiceStatusModalTitle.textContent = 'Outstanding invoices (' + items.length + ')';
  }

  if (items.length === 0) {
    invoiceStatusModalBody.innerHTML = '<p class="chart-empty">Nothing here.</p>';
    return;
  }

  invoiceStatusModalBody.innerHTML = items.map(({ deal, invoice }) => {
    const amount = invoiceTotal(invoice.items);
    const amountLabel = formatInvoiceAmount(amount, invoice.currency);
    const suggestion = buildInvoiceSuggestion(kind, invoice);
    const reminder = kind === 'outstanding' ? buildReminderLink(deal, invoice, amountLabel) : null;

    return '' +
      '<div class="invoice-status-row">' +
        '<div class="invoice-status-row__main">' +
          '<span class="invoice-status-row__entity">' + escapeHtml(deal.entityName || 'Untitled entity') + '</span>' +
          '<span class="invoice-status-row__number">' + escapeHtml(invoice.number) + (invoice.dueDate ? ' · due ' + escapeHtml(invoice.dueDate) : '') + '</span>' +
        '</div>' +
        '<div class="invoice-status-row__amount mono-figure">' + amountLabel + '</div>' +
        '<div class="invoice-status-row__suggestion invoice-status-row__suggestion--' + suggestion.tone + '">' + escapeHtml(suggestion.text) + '</div>' +
        '<div class="invoice-status-row__actions">' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" data-view-status-invoice="' + invoice.id + '" data-view-status-deal="' + deal.id + '" title="View invoice"><i class="bi bi-eye"></i></button>' +
          (kind === 'outstanding' ? '<button type="button" class="btn btn-sm btn-outline-secondary" data-mark-paid-invoice="' + invoice.id + '" data-mark-paid-deal="' + deal.id + '" title="Mark paid"><i class="bi bi-check-circle"></i></button>' : '') +
          (reminder ? '<a class="btn btn-sm btn-outline-secondary" href="' + escapeHtml(reminder.href) + '" target="_blank" rel="noopener" title="' + reminder.label + '"><i class="bi ' + reminder.icon + '"></i></a>' : '') +
        '</div>' +
      '</div>';
  }).join('');
}

function openInvoiceStatusList(kind) {
  renderInvoiceStatusList(kind);
  invoiceStatusModal.show();
}

invoiceStatusModalBody.addEventListener('click', (e) => {
  const viewBtn = e.target.closest('[data-view-status-invoice]');
  if (viewBtn) { openInvoicePrintView(viewBtn.dataset.viewStatusDeal, viewBtn.dataset.viewStatusInvoice); return; }

  const paidBtn = e.target.closest('[data-mark-paid-invoice]');
  if (paidBtn) {
    setInvoiceStatus(paidBtn.dataset.markPaidDeal, paidBtn.dataset.markPaidInvoice, 'paid');
    renderInvoiceStatusList('outstanding'); // refresh the list in place rather than closing the modal
  }
});

// ---------- Orchestration ----------
function renderFinancial() {
  renderFinancialStats();
  renderFinancialInvoicesTable();
  renderExpensesTable();
  const financialViewEl = document.getElementById('financialView');
  if (financialViewEl && !financialViewEl.classList.contains('d-none')) {
    renderIncomeExpenseChart();
  }
}
