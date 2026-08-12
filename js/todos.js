/* ============================================================
   todos.js
   ------------------------------------------------------------
   Standalone tasks — personal admin work, ideas, follow-ups that
   aren't tied to a specific client. Storage lives in storage.js
   (getTodos/saveTodo/deleteTodo/toggleTodoDone), same CRUD +
   Supabase + realtime pattern as expenses.

   A todo can optionally link to a deal (dealId) so it shows up
   on that deal's radar too, but most todos won't have one.
   Recurring todos (daily/weekly/monthly) spin up their next
   occurrence automatically when marked done — see
   toggleTodoDone() in storage.js.

   Exposes: renderTodos()
   ============================================================ */

const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High' };
const PRIORITY_TONE = { low: 'slate', normal: 'cyan', high: 'danger' };
const RECURRING_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

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

function todoRow(todo) {
  const deal = todo.dealId ? getDeals().find(d => d.id === todo.dealId) : null;
  const tone = todoUrgencyTone(todo);
  const dueLabel = todo.dueDate ? relativeDayLabel(todo.dueDate) : '';
  const isDone = todo.status === 'done';

  return '' +
    '<div class="todo-row todo-row--' + tone + (isDone ? ' todo-row--done' : '') + '" data-id="' + todo.id + '">' +
      '<button type="button" class="todo-row__check" data-toggle="' + todo.id + '" title="' + (isDone ? 'Mark not done' : 'Mark done') + '" aria-label="Toggle done">' +
        '<i class="bi ' + (isDone ? 'bi-check-circle-fill' : 'bi-circle') + '"></i>' +
      '</button>' +
      '<button type="button" class="todo-row__main" data-edit="' + todo.id + '">' +
        '<span class="todo-row__title">' + escapeHtml(todo.title) + '</span>' +
        (todo.notes ? '<span class="todo-row__notes">' + escapeHtml(todo.notes) + '</span>' : '') +
        '<span class="todo-row__meta">' +
          (dueLabel ? '<span class="todo-row__due todo-row__due--' + tone + '"><i class="bi bi-calendar-event"></i>' + escapeHtml(dueLabel) + '</span>' : '') +
          (todo.priority && todo.priority !== 'normal' ? '<span class="priority-badge priority-badge--' + PRIORITY_TONE[todo.priority] + '">' + PRIORITY_LABELS[todo.priority] + '</span>' : '') +
          (todo.recurring ? '<span class="todo-row__recurring" title="Repeats ' + RECURRING_LABELS[todo.recurring] + '"><i class="bi bi-arrow-repeat"></i>' + RECURRING_LABELS[todo.recurring] + '</span>' : '') +
          (deal ? '<span class="todo-row__deal-chip"><i class="bi bi-journal-text"></i>' + escapeHtml(deal.entityName || 'Untitled entity') + '</span>' : '') +
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

// ---------- Full edit modal ----------
const todoModalEl = document.getElementById('todoModal');
const todoModal = new bootstrap.Modal(todoModalEl);
const todoModalTitle = document.getElementById('todoModalTitle');
const todoIdInput = document.getElementById('todoId');
const todoTitleInput = document.getElementById('todoTitle');
const todoNotesInput = document.getElementById('todoNotes');
const todoDueDateInput = document.getElementById('todoDueDate');
const todoPriorityInput = document.getElementById('todoPriority');
const todoRecurringInput = document.getElementById('todoRecurring');
const todoDealSelect = document.getElementById('todoDeal');
const todoDeleteBtn = document.getElementById('todoDeleteBtn');
const todoForm = document.getElementById('todoForm');

function populateTodoDealSelect(selectedId) {
  const options = ['<option value="">Not linked to a deal</option>']
    .concat(getDeals().map(d => '<option value="' + d.id + '">' + escapeHtml(d.entityName || 'Untitled entity') + '</option>'));
  todoDealSelect.innerHTML = options.join('');
  todoDealSelect.value = selectedId || '';
}

function openTodoModal(id) {
  const existing = id ? getTodos().find(t => t.id === id) : null;

  if (existing) {
    todoModalTitle.textContent = 'Edit task';
    todoIdInput.value = existing.id;
    todoTitleInput.value = existing.title || '';
    todoNotesInput.value = existing.notes || '';
    todoDueDateInput.value = existing.dueDate || '';
    todoPriorityInput.value = existing.priority || 'normal';
    todoRecurringInput.value = existing.recurring || '';
    populateTodoDealSelect(existing.dealId);
    todoDeleteBtn.classList.remove('d-none');
  } else {
    todoModalTitle.textContent = 'New task';
    todoIdInput.value = '';
    todoTitleInput.value = '';
    todoNotesInput.value = '';
    todoDueDateInput.value = '';
    todoPriorityInput.value = 'normal';
    todoRecurringInput.value = '';
    populateTodoDealSelect('');
    todoDeleteBtn.classList.add('d-none');
  }
  todoModal.show();
  setTimeout(() => todoTitleInput.focus(), 200);
}

todoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = todoTitleInput.value.trim();
  if (!title) { todoTitleInput.focus(); return; }

  const wasEdit = Boolean(todoIdInput.value);
  saveTodo({
    id: todoIdInput.value || undefined,
    title,
    notes: todoNotesInput.value.trim(),
    dueDate: todoDueDateInput.value,
    priority: todoPriorityInput.value,
    recurring: todoRecurringInput.value,
    dealId: todoDealSelect.value || null,
  });

  todoModal.hide();
  renderEverything();
  showToast(wasEdit ? 'Task updated.' : 'Task added.');
});

todoDeleteBtn.addEventListener('click', () => {
  const id = todoIdInput.value;
  if (!id) return;
  if (!confirm('Delete this task? This can\'t be undone.')) return;
  deleteTodo(id);
  todoModal.hide();
  renderEverything();
  showToast('Task deleted.');
});

// "New task" entry point used by the page header button.
function openNewTodoModal() { openTodoModal(); }

document.getElementById('todosNewTaskBtn').addEventListener('click', openNewTodoModal);
