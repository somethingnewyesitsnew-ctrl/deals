/* ============================================================
   debts.js
   ------------------------------------------------------------
   Money owed, either direction. Same shape of UX as todos.js on
   purpose (filter chips, row list, modal editor) so the app stays
   consistent — storage lives in storage.js (getDebts/saveDebt/
   deleteDebt/toggleDebtPaid), same CRUD + Supabase + realtime
   pattern as everything else.

   Exposes: renderDebts()
   ============================================================ */

const DEBT_DIRECTION_LABELS = { i_owe: 'I owe', owed_to_me: 'Owed to me' };

const debtsFilterBar = document.getElementById('debtsFilterBar');
const debtsListEl = document.getElementById('debtsList');
const debtsEmptyState = document.getElementById('debtsEmptyState');
const debtsSummaryEl = document.getElementById('debtsSummary');

let debtsActiveFilter = 'open'; // 'all' | 'open' | 'i_owe' | 'owed_to_me' | 'overdue' | 'paid'

function debtDaysUntil(dateStr) {
  if (!dateStr) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((new Date(dateStr + 'T00:00:00') - new Date(new Date().toDateString())) / dayMs);
}

function debtUrgencyTone(debt) {
  if (debt.status === 'paid') return 'slate';
  if (!debt.dueDate) return 'slate';
  const d = debtDaysUntil(debt.dueDate);
  if (d < 0) return 'danger';
  if (d <= 3) return 'amber';
  return 'slate';
}

function matchesDebtFilter(debt, filter) {
  if (filter === 'all') return true;
  if (filter === 'paid') return debt.status === 'paid';
  if (debt.status === 'paid') return false;
  if (filter === 'open') return true;
  if (filter === 'i_owe') return debt.direction === 'i_owe';
  if (filter === 'owed_to_me') return debt.direction === 'owed_to_me';
  if (filter === 'overdue') { const d = debtDaysUntil(debt.dueDate); return d !== null && d < 0; }
  return true;
}

function renderDebtsFilterBar(counts) {
  const filters = [
    ['open', 'Open', counts.open],
    ['i_owe', 'I owe', counts.iOwe],
    ['owed_to_me', 'Owed to me', counts.owedToMe],
    ['overdue', 'Overdue', counts.overdue],
    ['paid', 'Paid', counts.paid],
    ['all', 'All', counts.all],
  ];
  debtsFilterBar.innerHTML = filters.map(([key, label, count]) =>
    '<button type="button" class="todo-filter-chip' + (debtsActiveFilter === key ? ' is-active' : '') + '" data-debt-filter="' + key + '">' +
      label + '<span class="chip-count">' + count + '</span>' +
    '</button>'
  ).join('');
}

function debtRow(debt) {
  const tone = debtUrgencyTone(debt);
  const dueLabel = debt.dueDate ? relativeDayLabel(debt.dueDate) : '';
  const isPaid = debt.status === 'paid';
  const links = debt.links || [];
  const directionTone = debt.direction === 'owed_to_me' ? 'green' : 'danger';
  const sign = debt.direction === 'owed_to_me' ? '+' : '−';

  const linkChipsHtml = links.slice(0, 4).map((l, i) => {
    const meta = LINK_TYPE_META[l.type] || LINK_TYPE_META.custom;
    return '<button type="button" class="todo-row__link-chip" data-row-link="' + i + '"><i class="bi ' + meta.icon + '"></i>' + escapeHtml(l.label) + '</button>';
  }).join('') + (links.length > 4 ? '<span class="todo-row__link-chip todo-row__link-chip--more">+' + (links.length - 4) + '</span>' : '');

  return '' +
    '<div class="todo-row todo-row--' + tone + (isPaid ? ' todo-row--done' : '') + '" data-id="' + debt.id + '">' +
      '<button type="button" class="todo-row__check" data-toggle="' + debt.id + '" title="' + (isPaid ? 'Mark unpaid' : 'Mark paid') + '" aria-label="Toggle paid">' +
        '<i class="bi ' + (isPaid ? 'bi-check-circle-fill' : 'bi-circle') + '"></i>' +
      '</button>' +
      '<div class="todo-row__body">' +
        '<button type="button" class="todo-row__main" data-edit="' + debt.id + '">' +
          '<span class="todo-row__title">' + escapeHtml(debt.description) + (debt.counterparty ? ' <span class="todo-row__notes">— ' + escapeHtml(debt.counterparty) + '</span>' : '') + '</span>' +
          '<span class="todo-row__meta">' +
            '<span class="priority-badge priority-badge--' + directionTone + '">' + DEBT_DIRECTION_LABELS[debt.direction] + '</span>' +
            '<span class="todo-row__money todo-row__money--' + directionTone + '">' + sign + formatInvoiceAmount(debt.amount, debt.currency) + '</span>' +
            (dueLabel ? '<span class="todo-row__due todo-row__due--' + tone + '"><i class="bi bi-calendar-event"></i>' + escapeHtml(dueLabel) + '</span>' : '') +
          '</span>' +
        '</button>' +
        (links.length ? '<div class="todo-row__links">' + linkChipsHtml + '</div>' : '') +
      '</div>' +
      '<button type="button" class="todo-row__remove" data-remove="' + debt.id + '" aria-label="Delete debt"><i class="bi bi-trash3"></i></button>' +
    '</div>';
}

function renderDebts() {
  const all = getDebts();
  const todayKey = todayDateKey();

  const counts = {
    all: all.length,
    paid: all.filter(d => d.status === 'paid').length,
    open: all.filter(d => d.status === 'open').length,
    iOwe: all.filter(d => d.status === 'open' && d.direction === 'i_owe').length,
    owedToMe: all.filter(d => d.status === 'open' && d.direction === 'owed_to_me').length,
    overdue: all.filter(d => d.status === 'open' && d.dueDate && d.dueDate < todayKey).length,
  };

  debtsSummaryEl.innerHTML = [
    ['I owe', formatInvoiceAmount(all.filter(d => d.status === 'open' && d.direction === 'i_owe').reduce((s, d) => s + toUSD(d.amount, d.currency), 0), 'USD'), 'bi-arrow-up-circle', 'danger'],
    ['Owed to me', formatInvoiceAmount(all.filter(d => d.status === 'open' && d.direction === 'owed_to_me').reduce((s, d) => s + toUSD(d.amount, d.currency), 0), 'USD'), 'bi-arrow-down-circle', 'green'],
    ['Overdue', counts.overdue, 'bi-exclamation-circle', 'amber'],
    ['Open total', counts.open, 'bi-credit-card', 'slate'],
  ].map(([label, value, icon, tone]) =>
    '<div class="attention-stat attention-stat--' + tone + '">' +
      '<i class="bi ' + icon + '"></i>' +
      '<span class="attention-stat__figure">' + value + '</span>' +
      '<span class="attention-stat__label">' + label + '</span>' +
    '</div>'
  ).join('');

  renderDebtsFilterBar(counts);

  let visible = all.filter(d => matchesDebtFilter(d, debtsActiveFilter));
  visible.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'paid' ? 1 : -1;
    if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  });

  if (visible.length === 0) {
    debtsListEl.innerHTML = '';
    debtsEmptyState.classList.remove('d-none');
  } else {
    debtsEmptyState.classList.add('d-none');
    debtsListEl.innerHTML = visible.map(debtRow).join('');
  }
}

debtsFilterBar.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-debt-filter]');
  if (!chip) return;
  debtsActiveFilter = chip.dataset.debtFilter;
  renderDebts();
});

debtsListEl.addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn) {
    toggleDebtPaid(toggleBtn.dataset.toggle);
    renderDebts();
    if (typeof updateTabCounts === 'function') updateTabCounts();
    return;
  }
  const removeBtn = e.target.closest('[data-remove]');
  if (removeBtn) {
    if (!confirm('Delete this debt record? This can\'t be undone.')) return;
    deleteDebt(removeBtn.dataset.remove);
    renderDebts();
    if (typeof updateTabCounts === 'function') updateTabCounts();
    showToast('Debt deleted.');
    return;
  }
  const rowLinkBtn = e.target.closest('[data-row-link]');
  if (rowLinkBtn) {
    const rowEl = rowLinkBtn.closest('.todo-row');
    const debt = getDebts().find(d => d.id === rowEl.dataset.id);
    const link = debt && (debt.links || [])[Number(rowLinkBtn.dataset.rowLink)];
    if (link) openLinkDetails(link);
    return;
  }
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) openDebtModal(editBtn.dataset.edit);
});

/* ============================================================
   Debt editor modal
   ============================================================ */
const debtModalEl = document.getElementById('debtModal');
const debtModal = new bootstrap.Modal(debtModalEl);
const debtModalTitle = document.getElementById('debtModalTitle');
const debtIdInput = document.getElementById('debtId');
const debtDescriptionInput = document.getElementById('debtDescription');
const debtCounterpartyInput = document.getElementById('debtCounterparty');
const debtDueDateInput = document.getElementById('debtDueDate');
const debtAmountInput = document.getElementById('debtAmount');
const debtNotesInput = document.getElementById('debtNotes');
const debtDeleteBtn = document.getElementById('debtDeleteBtn');
const debtForm = document.getElementById('debtForm');

const debtLinkPicker = createLinkPicker({
  container: document.getElementById('debtLinkPickerContainer'),
  chipsEl: document.getElementById('debtLinkChips'),
});

function openDebtModal(id) {
  const existing = id ? getDebts().find(d => d.id === id) : null;

  if (existing) {
    debtModalTitle.textContent = 'Edit debt';
    debtIdInput.value = existing.id;
    debtDescriptionInput.value = existing.description || '';
    debtCounterpartyInput.value = existing.counterparty || '';
    debtDueDateInput.value = existing.dueDate || '';
    debtAmountInput.value = existing.amount || '';
    debtNotesInput.value = existing.notes || '';
    document.getElementById(existing.currency === 'SDG' ? 'debtCurrencySDG' : 'debtCurrencyUSD').checked = true;
    document.getElementById(existing.direction === 'owed_to_me' ? 'debtDirectionOwedToMe' : 'debtDirectionIOwe').checked = true;
    debtDeleteBtn.classList.remove('d-none');
  } else {
    debtModalTitle.textContent = 'New debt';
    debtIdInput.value = '';
    debtDescriptionInput.value = '';
    debtCounterpartyInput.value = '';
    debtDueDateInput.value = '';
    debtAmountInput.value = '';
    debtNotesInput.value = '';
    document.getElementById('debtCurrencyUSD').checked = true;
    document.getElementById('debtDirectionIOwe').checked = true;
    debtDeleteBtn.classList.add('d-none');
  }

  debtLinkPicker.reset();
  debtLinkPicker.setLinks(existing ? existing.links || [] : []);

  debtModal.show();
  setTimeout(() => debtDescriptionInput.focus(), 200);
}

debtForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const description = debtDescriptionInput.value.trim();
  const amount = Number(debtAmountInput.value) || 0;
  if (!description || !amount) {
    showToast('Add a description and an amount first.');
    return;
  }

  const wasEdit = Boolean(debtIdInput.value);
  saveDebt({
    id: debtIdInput.value || undefined,
    description,
    counterparty: debtCounterpartyInput.value.trim(),
    dueDate: debtDueDateInput.value,
    amount,
    currency: document.getElementById('debtCurrencySDG').checked ? 'SDG' : 'USD',
    direction: document.getElementById('debtDirectionOwedToMe').checked ? 'owed_to_me' : 'i_owe',
    notes: debtNotesInput.value.trim(),
    links: debtLinkPicker.getLinks(),
  });

  debtModal.hide();
  renderDebts();
  if (typeof updateTabCounts === 'function') updateTabCounts();
  showToast(wasEdit ? 'Debt updated.' : 'Debt recorded.');
});

debtDeleteBtn.addEventListener('click', () => {
  const id = debtIdInput.value;
  if (!id) return;
  if (!confirm('Delete this debt record? This can\'t be undone.')) return;
  deleteDebt(id);
  debtModal.hide();
  renderDebts();
  if (typeof updateTabCounts === 'function') updateTabCounts();
  showToast('Debt deleted.');
});

// Entry point used by the FAB speed-dial.
function openNewDebtModal() { openDebtModal(); }
