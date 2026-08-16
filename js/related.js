/* ============================================================
   related.js
   ------------------------------------------------------------
   Two small, focused popups that keep "see what's connected to
   this" from dumping the user into a whole other tab:

   1. Related Deals modal — the "N deals" chip on Referrals/
      Contacts/Entities rows used to jump into the full Deals tab
      (money-stat cards, funnel, charts and all). Now it opens a
      short list of just those deals; click one to open its
      detail drawer directly.

   2. Linked Items badge + modal — a small paperclip+count badge
      renderable on any table row, showing how many to-dos,
      expenses/income, or debts link to that specific deal/
      referral/contact/entity (via the universal `links` array —
      see links.js). Click it to see the list; click an item to
      open its own editor.

   Exposes:
     - openRelatedDealsModal(title, deals)
     - countLinksTo(type, id)
     - linkedItemsBadgeHtml(type, id)
     - openLinkedItemsModal(type, id, label)
   ============================================================ */

const relatedItemsModalEl = document.getElementById('relatedItemsModal');
const relatedItemsModal = new bootstrap.Modal(relatedItemsModalEl);
const relatedItemsTitle = document.getElementById('relatedItemsTitle');
const relatedItemsBody = document.getElementById('relatedItemsBody');

function openRelatedDealsModal(title, deals) {
  relatedItemsTitle.textContent = title;

  relatedItemsBody.innerHTML = deals.length
    ? '<div class="attention-list">' + deals.map(d => '' +
        '<button type="button" class="attention-row" data-related-deal="' + d.id + '">' +
          '<span class="attention-row__name" title="' + escapeHtml(d.entityName || 'Untitled entity') + '">' + escapeHtml(d.entityName || 'Untitled entity') + '</span>' +
          '<span class="stage-badge stage-badge--' + d.stage + '">' + d.stage + '</span>' +
          '<span class="attention-row__note">' + formatDualCurrency(d.value, d.currency) + '</span>' +
          '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
        '</button>'
      ).join('') + '</div>'
    : '<p class="no-referral">No deals found.</p>';

  relatedItemsModal.show();
}

relatedItemsBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-related-deal]');
  if (!btn) return;
  relatedItemsModal.hide();
  switchView('deals');
  openDetailModal(btn.dataset.relatedDeal);
});

/* ---------- Linked items (to-dos / expenses / debts pointing at X) ---------- */
function collectLinkedItems(type, id) {
  const todosLinked = getTodos().filter(t => (t.links || []).some(l => l.type === type && l.id === id));
  const expensesLinked = (typeof getExpenses === 'function' ? getExpenses() : []).filter(e => (e.links || []).some(l => l.type === type && l.id === id));
  const debtsLinked = (typeof getDebts === 'function' ? getDebts() : []).filter(d => (d.links || []).some(l => l.type === type && l.id === id));
  return { todosLinked, expensesLinked, debtsLinked };
}

function countLinksTo(type, id) {
  const { todosLinked, expensesLinked, debtsLinked } = collectLinkedItems(type, id);
  return todosLinked.length + expensesLinked.length + debtsLinked.length;
}

function linkedItemsBadgeHtml(type, id) {
  const count = countLinksTo(type, id);
  if (!count) return '';
  return '<button type="button" class="linked-badge" data-linked-type="' + type + '" data-linked-id="' + escapeHtml(id) + '" title="' + count + ' linked item' + (count === 1 ? '' : 's') + '"><i class="bi bi-paperclip"></i>' + count + '</button>';
}

const linkedItemsModalEl = document.getElementById('linkedItemsModal');
const linkedItemsModal = new bootstrap.Modal(linkedItemsModalEl);
const linkedItemsTitle = document.getElementById('linkedItemsTitle');
const linkedItemsBody = document.getElementById('linkedItemsBody');

function openLinkedItemsModal(type, id, label) {
  linkedItemsTitle.textContent = 'Linked to ' + label;
  const { todosLinked, expensesLinked, debtsLinked } = collectLinkedItems(type, id);

  const sections = [];

  if (todosLinked.length) {
    sections.push('<h4 class="linked-items__section-title"><i class="bi bi-list-check"></i> Tasks</h4><div class="attention-list mb-3">' +
      todosLinked.map(t => '' +
        '<button type="button" class="attention-row" data-open-todo="' + t.id + '">' +
          '<span class="attention-row__name">' + escapeHtml(t.title) + '</span>' +
          (t.status === 'done' ? '<span class="status-badge status-badge--done">Done</span>' : (t.dueDate ? '<span class="attention-row__context">' + escapeHtml(relativeDayLabel(t.dueDate)) + '</span>' : '')) +
          '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
        '</button>'
      ).join('') + '</div>');
  }

  if (expensesLinked.length) {
    sections.push('<h4 class="linked-items__section-title"><i class="bi bi-wallet2"></i> Financial</h4><div class="attention-list mb-3">' +
      expensesLinked.map(exp => '' +
        '<button type="button" class="attention-row" data-open-expense="' + exp.id + '">' +
          '<span class="attention-row__name">' + escapeHtml(exp.description) + '</span>' +
          '<span class="status-badge status-badge--' + (exp.kind === 'income' ? 'done' : 'canceled') + '">' + (exp.kind === 'income' ? 'Income' : 'Expense') + '</span>' +
          '<span class="attention-row__note">' + formatInvoiceAmount(exp.amount, exp.currency) + '</span>' +
          '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
        '</button>'
      ).join('') + '</div>');
  }

  if (debtsLinked.length) {
    sections.push('<h4 class="linked-items__section-title"><i class="bi bi-credit-card"></i> Debts</h4><div class="attention-list mb-3">' +
      debtsLinked.map(d => '' +
        '<button type="button" class="attention-row" data-open-debt="' + d.id + '">' +
          '<span class="attention-row__name">' + escapeHtml(d.description) + '</span>' +
          '<span class="status-badge status-badge--' + (d.status === 'paid' ? 'done' : 'note') + '">' + (d.status === 'paid' ? 'Paid' : DEBT_DIRECTION_LABELS[d.direction]) + '</span>' +
          '<span class="attention-row__note">' + formatInvoiceAmount(d.amount, d.currency) + '</span>' +
          '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
        '</button>'
      ).join('') + '</div>');
  }

  linkedItemsBody.innerHTML = sections.length ? sections.join('') : '<p class="no-referral">Nothing linked yet.</p>';
  linkedItemsModal.show();
}

linkedItemsBody.addEventListener('click', (e) => {
  const todoBtn = e.target.closest('[data-open-todo]');
  if (todoBtn) { linkedItemsModal.hide(); openTodoModal(todoBtn.dataset.openTodo); return; }
  const expenseBtn = e.target.closest('[data-open-expense]');
  if (expenseBtn) { linkedItemsModal.hide(); switchView('financial'); openExpenseModal(expenseBtn.dataset.openExpense); return; }
  const debtBtn = e.target.closest('[data-open-debt]');
  if (debtBtn) { linkedItemsModal.hide(); switchView('debts'); openDebtModal(debtBtn.dataset.openDebt); return; }
});

// Delegated, document-level handler so every table (Deals/Referrals/
// Contacts/Entities) gets clickable badges for free without each file
// needing its own listener.
document.addEventListener('click', (e) => {
  const badge = e.target.closest('.linked-badge');
  if (!badge) return;
  const type = badge.dataset.linkedType;
  const id = badge.dataset.linkedId;
  const row = badge.closest('tr, .todo-row');
  const label = (row && row.querySelector('.deal-name, .todo-row__title, .attention-row__name'))
    ? (row.querySelector('.deal-name, .todo-row__title, .attention-row__name').textContent || '').trim()
    : 'this item';
  openLinkedItemsModal(type, id, label);
});
