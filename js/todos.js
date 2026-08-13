/* ============================================================
   todos.js
   ------------------------------------------------------------
   Standalone tasks — personal admin work, ideas, follow-ups that
   aren't tied to a specific client. Storage lives in storage.js
   (getTodos/saveTodo/deleteTodo/toggleTodoDone), same CRUD +
   Supabase + realtime pattern as expenses.

   A todo can:
     - link to ANYTHING in the system (deal, contact, referral,
       entity, invoice) or a free-typed custom tag — see `links`
     - break down into subtasks (a mini checklist)
     - carry documents (small file or a link)
     - carry money (amount + currency + expense/income), which
       storage.js automatically mirrors into the Financial tab
       (see _syncTodoLinkedExpense in storage.js)

   Recurring todos (daily/weekly/monthly) spin up their next
   occurrence automatically when marked done.

   Exposes: renderTodos()
   ============================================================ */

const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High' };
const PRIORITY_TONE = { low: 'slate', normal: 'cyan', high: 'danger' };
const RECURRING_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

const LINK_TYPE_META = {
  deal: { icon: 'bi-journal-text', label: 'Deal' },
  contact: { icon: 'bi-person', label: 'Contact' },
  referral: { icon: 'bi-arrow-up-right-circle', label: 'Referral' },
  entity: { icon: 'bi-building', label: 'Entity' },
  invoice: { icon: 'bi-receipt', label: 'Invoice' },
  custom: { icon: 'bi-tag', label: 'Tag' },
};

const todosQuickAddInput = document.getElementById('todosQuickAddInput');
const todosQuickAddBtn = document.getElementById('todosQuickAddBtn');
const todosFilterBar = document.getElementById('todosFilterBar');
const todosListEl = document.getElementById('todosList');
const todosEmptyState = document.getElementById('todosEmptyState');
const todosSummaryEl = document.getElementById('todosSummary');

let todosActiveFilter = 'open'; // 'all' | 'open' | 'overdue' | 'today' | 'upcoming' | 'done'

function todayDateKey() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

function todoDaysUntil(dateStr) {
  if (!dateStr) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((new Date(dateStr + 'T00:00:00') - new Date(new Date().toDateString())) / dayMs);
}

function todoUrgencyTone(todo) {
  if (todo.status === 'done') return 'slate';
  if (!todo.dueDate) return 'slate';
  const d = todoDaysUntil(todo.dueDate);
  if (d < 0) return 'danger';
  if (d <= 2) return 'amber';
  return 'slate';
}

function matchesTodoFilter(todo, filter) {
  const d = todo.dueDate ? todoDaysUntil(todo.dueDate) : null;
  if (filter === 'all') return true;
  if (filter === 'done') return todo.status === 'done';
  if (todo.status === 'done') return false; // every other filter is implicitly "open"
  if (filter === 'open') return true;
  if (filter === 'overdue') return d !== null && d < 0;
  if (filter === 'today') return d === 0;
  if (filter === 'upcoming') return d !== null && d > 0 && d <= 7;
  return true;
}

function renderFilterBar(counts) {
  const filters = [
    ['open', 'Open', counts.open],
    ['overdue', 'Overdue', counts.overdue],
    ['today', 'Due today', counts.today],
    ['upcoming', 'Upcoming', counts.upcoming],
    ['done', 'Done', counts.done],
    ['all', 'All', counts.all],
  ];
  todosFilterBar.innerHTML = filters.map(([key, label, count]) =>
    '<button type="button" class="todo-filter-chip' + (todosActiveFilter === key ? ' is-active' : '') + '" data-filter="' + key + '">' +
      label + '<span class="chip-count">' + count + '</span>' +
    '</button>'
  ).join('');
}

function todoMoneyBadge(todo) {
  if (!(Number(todo.amount) > 0) || !todo.moneyKind) return '';
  const sign = todo.moneyKind === 'income' ? '+' : '−';
  const tone = todo.moneyKind === 'income' ? 'green' : 'danger';
  return '<span class="todo-row__money todo-row__money--' + tone + '">' + sign + formatInvoiceAmount(todo.amount, todo.currency || 'USD') + '</span>';
}

function todoRow(todo) {
  const tone = todoUrgencyTone(todo);
  const dueLabel = todo.dueDate ? relativeDayLabel(todo.dueDate) : '';
  const isDone = todo.status === 'done';
  const links = todo.links || [];
  const subtasks = todo.subtasks || [];
  const doneSubtasks = subtasks.filter(s => s.done).length;

  const linkChips = links.slice(0, 3).map(l => {
    const meta = LINK_TYPE_META[l.type] || LINK_TYPE_META.custom;
    return '<span class="todo-row__link-chip"><i class="bi ' + meta.icon + '"></i>' + escapeHtml(l.label) + '</span>';
  }).join('') + (links.length > 3 ? '<span class="todo-row__link-chip todo-row__link-chip--more">+' + (links.length - 3) + '</span>' : '');

  return '' +
    '<div class="todo-row todo-row--' + tone + (isDone ? ' todo-row--done' : '') + '" data-id="' + todo.id + '">' +
      '<button type="button" class="todo-row__check" data-toggle="' + todo.id + '" title="' + (isDone ? 'Mark not done' : 'Mark done') + '" aria-label="Toggle done">' +
        '<i class="bi ' + (isDone ? 'bi-check-circle-fill' : 'bi-circle') + '"></i>' +
      '</button>' +
      '<button type="button" class="todo-row__main" data-edit="' + todo.id + '">' +
        '<span class="todo-row__title">' + escapeHtml(todo.title) + '</span>' +
        (todo.notes ? '<span class="todo-row__notes">' + escapeHtml(todo.notes) + '</span>' : '') +
        (subtasks.length ? '<span class="todo-row__subtask-progress"><span class="todo-row__subtask-bar"><span style="width:' + Math.round((doneSubtasks / subtasks.length) * 100) + '%"></span></span>' + doneSubtasks + '/' + subtasks.length + ' subtasks</span>' : '') +
        '<span class="todo-row__meta">' +
          (dueLabel ? '<span class="todo-row__due todo-row__due--' + tone + '"><i class="bi bi-calendar-event"></i>' + escapeHtml(dueLabel) + '</span>' : '') +
          (todo.priority && todo.priority !== 'normal' ? '<span class="priority-badge priority-badge--' + PRIORITY_TONE[todo.priority] + '">' + PRIORITY_LABELS[todo.priority] + '</span>' : '') +
          (todo.recurring ? '<span class="todo-row__recurring" title="Repeats ' + RECURRING_LABELS[todo.recurring] + '"><i class="bi bi-arrow-repeat"></i>' + RECURRING_LABELS[todo.recurring] + '</span>' : '') +
          todoMoneyBadge(todo) +
          ((todo.documents || []).length ? '<span class="todo-row__doc-count"><i class="bi bi-paperclip"></i>' + todo.documents.length + '</span>' : '') +
          linkChips +
        '</span>' +
      '</button>' +
      '<button type="button" class="todo-row__remove" data-remove="' + todo.id + '" aria-label="Delete task"><i class="bi bi-trash3"></i></button>' +
    '</div>';
}

function renderTodos() {
  const all = getTodos();
  const todayKey = todayDateKey();

  const counts = {
    all: all.length,
    done: all.filter(t => t.status === 'done').length,
    open: all.filter(t => t.status === 'open').length,
    overdue: all.filter(t => t.status === 'open' && t.dueDate && t.dueDate < todayKey).length,
    today: all.filter(t => t.status === 'open' && t.dueDate === todayKey).length,
    upcoming: all.filter(t => t.status === 'open' && t.dueDate && t.dueDate > todayKey && todoDaysUntil(t.dueDate) <= 7).length,
  };

  todosSummaryEl.innerHTML = [
    ['Open', counts.open, 'bi-list-check', 'cyan'],
    ['Overdue', counts.overdue, 'bi-exclamation-circle', 'danger'],
    ['Due today', counts.today, 'bi-calendar-day', 'amber'],
    ['Upcoming (7d)', counts.upcoming, 'bi-calendar-week', 'slate'],
  ].map(([label, count, icon, tone]) =>
    '<div class="attention-stat attention-stat--' + tone + '">' +
      '<i class="bi ' + icon + '"></i>' +
      '<span class="attention-stat__figure">' + count + '</span>' +
      '<span class="attention-stat__label">' + label + '</span>' +
    '</div>'
  ).join('');

  renderFilterBar(counts);

  let visible = all.filter(t => matchesTodoFilter(t, todosActiveFilter));
  visible.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
    if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
    if (a.dueDate !== b.dueDate) return (a.dueDate || '').localeCompare(b.dueDate || '');
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  if (visible.length === 0) {
    todosListEl.innerHTML = '';
    todosEmptyState.classList.remove('d-none');
  } else {
    todosEmptyState.classList.add('d-none');
    todosListEl.innerHTML = visible.map(todoRow).join('');
  }
}

// ---------- Quick-add (title only, hits Enter) ----------
function quickAddTodo() {
  const title = todosQuickAddInput.value.trim();
  if (!title) { todosQuickAddInput.focus(); return; }
  saveTodo({ title });
  todosQuickAddInput.value = '';
  renderEverything();
  showToast('Task added.');
}

todosQuickAddBtn.addEventListener('click', quickAddTodo);
todosQuickAddInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); quickAddTodo(); }
});

// ---------- Filter chips ----------
todosFilterBar.addEventListener('click', (e) => {
  const chip = e.target.closest('.todo-filter-chip');
  if (!chip) return;
  todosActiveFilter = chip.dataset.filter;
  renderTodos();
});

// ---------- Row interactions ----------
todosListEl.addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn) {
    toggleTodoDone(toggleBtn.dataset.toggle);
    renderEverything();
    return;
  }
  const removeBtn = e.target.closest('[data-remove]');
  if (removeBtn) {
    if (!confirm('Delete this task? This can\'t be undone.')) return;
    deleteTodo(removeBtn.dataset.remove);
    renderEverything();
    showToast('Task deleted.');
    return;
  }
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) openTodoModal(editBtn.dataset.edit);
});

/* ============================================================
   Full edit modal — links, subtasks, documents, money
   ============================================================ */
const todoModalEl = document.getElementById('todoModal');
const todoModal = new bootstrap.Modal(todoModalEl);
const todoModalTitle = document.getElementById('todoModalTitle');
const todoIdInput = document.getElementById('todoId');
const todoTitleInput = document.getElementById('todoTitle');
const todoNotesInput = document.getElementById('todoNotes');
const todoDueDateInput = document.getElementById('todoDueDate');
const todoPriorityInput = document.getElementById('todoPriority');
const todoRecurringInput = document.getElementById('todoRecurring');
const todoDeleteBtn = document.getElementById('todoDeleteBtn');
const todoForm = document.getElementById('todoForm');
const todoAmountInput = document.getElementById('todoAmount');

let todoEditLinks = [];
let todoEditSubtasks = [];
let todoEditDocuments = [];

// ---------- Universal link picker ----------
const todoLinkInput = document.getElementById('todoLinkInput');
const todoLinkResults = document.getElementById('todoLinkResults');
const todoLinkChips = document.getElementById('todoLinkChips');

function searchLinkableItems(term) {
  term = term.trim().toLowerCase();
  if (!term) return [];
  const results = [];

  getDeals().forEach(d => {
    if ((d.entityName || '').toLowerCase().includes(term)) {
      results.push({ type: 'deal', id: d.id, label: d.entityName || 'Untitled entity' });
    }
  });

  if (typeof buildContactGroups === 'function') {
    buildContactGroups().forEach(g => {
      if (g.name.toLowerCase().includes(term)) {
        results.push({ type: 'contact', id: contactKeyOf(g.name, g.number), label: g.name });
      }
    });
  }

  if (typeof buildReferralGroups === 'function') {
    buildReferralGroups().forEach(g => {
      if (g.name.toLowerCase().includes(term)) {
        results.push({ type: 'referral', id: g.name.toLowerCase(), label: g.name });
      }
    });
  }

  if (typeof buildEntityGroups === 'function') {
    buildEntityGroups().forEach(g => {
      if (g.name.toLowerCase().includes(term)) {
        results.push({ type: 'entity', id: g.name.toLowerCase(), label: g.name });
      }
    });
  }

  if (typeof getAllInvoicesFlat === 'function') {
    getAllInvoicesFlat().forEach(({ deal, invoice }) => {
      const hay = (invoice.number + ' ' + (deal.entityName || '')).toLowerCase();
      if (hay.includes(term)) {
        results.push({ type: 'invoice', id: invoice.id, dealId: deal.id, label: invoice.number + ' · ' + (deal.entityName || 'Untitled entity') });
      }
    });
  }

  return results.slice(0, 8);
}

function renderTodoLinkChips() {
  if (todoEditLinks.length === 0) {
    todoLinkChips.innerHTML = '<span class="no-referral">Nothing linked yet.</span>';
    return;
  }
  todoLinkChips.innerHTML = todoEditLinks.map((l, i) => {
    const meta = LINK_TYPE_META[l.type] || LINK_TYPE_META.custom;
    return '<span class="link-chip"><i class="bi ' + meta.icon + '"></i>' + escapeHtml(l.label) +
      '<button type="button" class="link-chip__remove" data-remove-link="' + i + '" aria-label="Remove link"><i class="bi bi-x"></i></button></span>';
  }).join('');
}

function addTodoLink(link) {
  const exists = todoEditLinks.some(l => l.type === link.type && l.id === link.id);
  if (exists) return;
  todoEditLinks.push(link);
  renderTodoLinkChips();
}

function renderLinkResults() {
  const matches = searchLinkableItems(todoLinkInput.value);
  if (matches.length === 0) {
    todoLinkResults.classList.add('d-none');
    return;
  }
  todoLinkResults.innerHTML = matches.map((m, i) => {
    const meta = LINK_TYPE_META[m.type] || LINK_TYPE_META.custom;
    return '<button type="button" class="link-picker__item" data-result-index="' + i + '">' +
      '<i class="bi ' + meta.icon + '"></i>' +
      '<span>' + escapeHtml(m.label) + '</span>' +
      '<span class="link-picker__type">' + meta.label + '</span>' +
    '</button>';
  }).join('');
  todoLinkResults._matches = matches;
  todoLinkResults.classList.remove('d-none');
}

todoLinkInput.addEventListener('input', renderLinkResults);
todoLinkInput.addEventListener('focus', renderLinkResults);

todoLinkInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const matches = todoLinkResults._matches || [];
  if (matches.length > 0 && !todoLinkResults.classList.contains('d-none')) {
    addTodoLink(matches[0]);
  } else {
    const text = todoLinkInput.value.trim();
    if (!text) return;
    addTodoLink({ type: 'custom', id: 'custom-' + Date.now(), label: text });
  }
  todoLinkInput.value = '';
  todoLinkResults.classList.add('d-none');
});

todoLinkResults.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-result-index]');
  if (!btn) return;
  const matches = todoLinkResults._matches || [];
  const item = matches[Number(btn.dataset.resultIndex)];
  if (item) addTodoLink(item);
  todoLinkInput.value = '';
  todoLinkResults.classList.add('d-none');
  todoLinkInput.focus();
});

todoLinkChips.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-link]');
  if (!btn) return;
  todoEditLinks.splice(Number(btn.dataset.removeLink), 1);
  renderTodoLinkChips();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.link-picker')) todoLinkResults.classList.add('d-none');
});

// ---------- Subtasks ----------
const todoSubtaskInput = document.getElementById('todoSubtaskInput');
const todoSubtaskAddBtn = document.getElementById('todoSubtaskAddBtn');
const todoSubtaskList = document.getElementById('todoSubtaskList');

function renderTodoSubtaskList() {
  if (todoEditSubtasks.length === 0) {
    todoSubtaskList.innerHTML = '<li class="comm-log-empty-msg">No subtasks yet.</li>';
    return;
  }
  todoSubtaskList.innerHTML = todoEditSubtasks.map(s =>
    '<li class="subtask-item' + (s.done ? ' subtask-item--done' : '') + '" data-id="' + s.id + '">' +
      '<button type="button" class="subtask-item__check" data-subtask-toggle="' + s.id + '"><i class="bi ' + (s.done ? 'bi-check-square-fill' : 'bi-square') + '"></i></button>' +
      '<span class="subtask-item__text">' + escapeHtml(s.text) + '</span>' +
      '<button type="button" class="subtask-item__remove" data-subtask-remove="' + s.id + '" aria-label="Remove subtask"><i class="bi bi-x-lg"></i></button>' +
    '</li>'
  ).join('');
}

function addSubtask() {
  const text = todoSubtaskInput.value.trim();
  if (!text) { todoSubtaskInput.focus(); return; }
  todoEditSubtasks.push({ id: crypto.randomUUID(), text, done: false });
  todoSubtaskInput.value = '';
  renderTodoSubtaskList();
}

todoSubtaskAddBtn.addEventListener('click', addSubtask);
todoSubtaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
});

todoSubtaskList.addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('[data-subtask-toggle]');
  if (toggleBtn) {
    const s = todoEditSubtasks.find(x => x.id === toggleBtn.dataset.subtaskToggle);
    if (s) s.done = !s.done;
    renderTodoSubtaskList();
    return;
  }
  const removeBtn = e.target.closest('[data-subtask-remove]');
  if (removeBtn) {
    todoEditSubtasks = todoEditSubtasks.filter(x => x.id !== removeBtn.dataset.subtaskRemove);
    renderTodoSubtaskList();
  }
});

// ---------- Documents ----------
const todoDocFile = document.getElementById('todoDocFile');
const todoDocUrl = document.getElementById('todoDocUrl');
const todoDocAddBtn = document.getElementById('todoDocAddBtn');
const todoDocList = document.getElementById('todoDocList');
const TODO_MAX_DOC_BYTES = 350 * 1024;

function renderTodoDocList() {
  if (todoEditDocuments.length === 0) {
    todoDocList.innerHTML = '<p class="no-referral">No documents attached yet.</p>';
    return;
  }
  todoDocList.innerHTML = todoEditDocuments.map(doc => '' +
    '<div class="document-row">' +
      '<span class="document-row__main">' +
        '<i class="bi ' + (doc.kind === 'link' ? 'bi-link-45deg' : 'bi-file-earmark') + ' document-row__icon"></i>' +
        '<span class="document-row__name">' + escapeHtml(doc.name) + '</span>' +
        '<span class="document-row__meta">' + (doc.kind === 'link' ? 'Link' : formatBytesShort(doc.size)) + '</span>' +
      '</span>' +
      '<button type="button" class="document-row__remove" data-doc-remove="' + doc.id + '" aria-label="Remove document"><i class="bi bi-trash3"></i></button>' +
    '</div>'
  ).join('');
}

function formatBytesShort(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  return Math.round(bytes / 1024) + ' KB';
}

todoDocAddBtn.addEventListener('click', () => {
  const file = todoDocFile.files[0];
  const url = todoDocUrl.value.trim();

  if (!file && !url) { showToast('Attach a file or paste a link first.'); return; }
  if (file && file.size > TODO_MAX_DOC_BYTES) {
    showToast('That file is ' + formatBytesShort(file.size) + ' — capped around 350KB here. Use a link for anything bigger.');
    return;
  }

  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      todoEditDocuments.push({ id: crypto.randomUUID(), name: file.name, kind: 'file', dataUrl: reader.result, mimeType: file.type, size: file.size, addedAt: Date.now() });
      todoDocFile.value = '';
      renderTodoDocList();
    };
    reader.readAsDataURL(file);
  } else {
    todoEditDocuments.push({ id: crypto.randomUUID(), name: url, kind: 'link', url, addedAt: Date.now() });
    todoDocUrl.value = '';
    renderTodoDocList();
  }
});

todoDocList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-doc-remove]');
  if (!btn) return;
  todoEditDocuments = todoEditDocuments.filter(d => d.id !== btn.dataset.docRemove);
  renderTodoDocList();
});

// ---------- Open / reset ----------
function resetTodoMoneyFields(existing) {
  todoAmountInput.value = existing && existing.amount ? existing.amount : '';
  document.getElementById(existing && existing.currency === 'SDG' ? 'todoCurrencySDG' : 'todoCurrencyUSD').checked = true;
  const kind = existing ? existing.moneyKind : '';
  document.getElementById(kind === 'expense' ? 'todoMoneyKindExpense' : kind === 'income' ? 'todoMoneyKindIncome' : 'todoMoneyKindNone').checked = true;
}

function openTodoModal(id) {
  const existing = id ? getTodos().find(t => t.id === id) : null;

  todoEditLinks = existing ? (existing.links || []).slice() : [];
  todoEditSubtasks = existing ? (existing.subtasks || []).map(s => Object.assign({}, s)) : [];
  todoEditDocuments = existing ? (existing.documents || []).slice() : [];

  if (existing) {
    todoModalTitle.textContent = 'Edit task';
    todoIdInput.value = existing.id;
    todoTitleInput.value = existing.title || '';
    todoNotesInput.value = existing.notes || '';
    todoDueDateInput.value = existing.dueDate || '';
    todoPriorityInput.value = existing.priority || 'normal';
    todoRecurringInput.value = existing.recurring || '';
    todoDeleteBtn.classList.remove('d-none');
  } else {
    todoModalTitle.textContent = 'New task';
    todoIdInput.value = '';
    todoTitleInput.value = '';
    todoNotesInput.value = '';
    todoDueDateInput.value = '';
    todoPriorityInput.value = 'normal';
    todoRecurringInput.value = '';
    todoDeleteBtn.classList.add('d-none');
  }

  resetTodoMoneyFields(existing);
  renderTodoLinkChips();
  renderTodoSubtaskList();
  renderTodoDocList();
  todoLinkInput.value = '';
  todoLinkResults.classList.add('d-none');

  todoModal.show();
  setTimeout(() => todoTitleInput.focus(), 200);
}

todoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = todoTitleInput.value.trim();
  if (!title) { todoTitleInput.focus(); return; }

  const moneyKind = document.querySelector('input[name="todoMoneyKind"]:checked').value;
  const dealLink = todoEditLinks.find(l => l.type === 'deal');

  const wasEdit = Boolean(todoIdInput.value);
  saveTodo({
    id: todoIdInput.value || undefined,
    title,
    notes: todoNotesInput.value.trim(),
    dueDate: todoDueDateInput.value,
    priority: todoPriorityInput.value,
    recurring: todoRecurringInput.value,
    dealId: dealLink ? dealLink.id : null,
    links: todoEditLinks,
    subtasks: todoEditSubtasks,
    documents: todoEditDocuments,
    amount: todoAmountInput.value ? Number(todoAmountInput.value) : null,
    currency: document.getElementById('todoCurrencySDG').checked ? 'SDG' : 'USD',
    moneyKind: moneyKind || '',
  });

  todoModal.hide();
  renderEverything();
  if (typeof renderFinancial === 'function') renderFinancial();
  showToast(wasEdit ? 'Task updated.' : 'Task added.');
});

todoDeleteBtn.addEventListener('click', () => {
  const id = todoIdInput.value;
  if (!id) return;
  if (!confirm('Delete this task? This can\'t be undone. If it has money linked, the matching Financial entry will be removed too.')) return;
  deleteTodo(id);
  todoModal.hide();
  renderEverything();
  if (typeof renderFinancial === 'function') renderFinancial();
  showToast('Task deleted.');
});

// "New task" entry point used by the FAB speed-dial.
function openNewTodoModal() { openTodoModal(); }
