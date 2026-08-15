/* ============================================================
   documentation.js
   ------------------------------------------------------------
   Every completed to-do lands here automatically — nothing new
   is stored, this is just a filtered/searchable view over
   getTodos().filter(status === 'done'), the same "computed, not
   stored" pattern Referrals/Contacts/Entities already use.

   Clicking an entry reopens the full To-Do editor (todos.js's
   openTodoModal) — reopening it there (unchecking "done") is how
   you "get back to it".

   Exposes: renderDocumentation()
   ============================================================ */

const documentationSearchInput = document.getElementById('documentationSearchInput');
const documentationFilterBar = document.getElementById('documentationFilterBar');
const documentationListEl = document.getElementById('documentationList');
const documentationEmptyState = document.getElementById('documentationEmptyState');

let documentationSearchTerm = '';
let documentationActiveFilter = 'all'; // 'all' | 'week' | 'month' | 'money' | 'linked'

function getCompletedTodos() {
  return getTodos().filter(t => t.status === 'done').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
}

function matchesDocumentationFilter(todo, filter) {
  const daysSince = todo.completedAt ? (Date.now() - todo.completedAt) / (24 * 60 * 60 * 1000) : Infinity;
  if (filter === 'all') return true;
  if (filter === 'week') return daysSince <= 7;
  if (filter === 'month') return daysSince <= 30;
  if (filter === 'money') return Number(todo.amount) > 0 && !!todo.moneyKind;
  if (filter === 'linked') return (todo.links || []).length > 0;
  return true;
}

function matchesDocumentationSearch(todo, term) {
  if (!term) return true;
  const hay = [
    todo.title, todo.notes,
    ...(todo.links || []).map(l => l.label),
    ...(todo.subtasks || []).map(s => s.text),
  ].join(' ').toLowerCase();
  return hay.includes(term);
}

function documentationRow(todo) {
  const links = todo.links || [];
  const subtasks = todo.subtasks || [];
  const doneSubtasks = subtasks.filter(s => s.done).length;

  const linkChipsHtml = links.slice(0, 4).map((l, i) => {
    const meta = LINK_TYPE_META[l.type] || LINK_TYPE_META.custom;
    return '<button type="button" class="todo-row__link-chip" data-row-link="' + i + '"><i class="bi ' + meta.icon + '"></i>' + escapeHtml(l.label) + '</button>';
  }).join('') + (links.length > 4 ? '<span class="todo-row__link-chip todo-row__link-chip--more">+' + (links.length - 4) + '</span>' : '');

  return '' +
    '<div class="todo-row todo-row--slate todo-row--done" data-id="' + todo.id + '">' +
      '<span class="todo-row__check" style="cursor:default"><i class="bi bi-check-circle-fill"></i></span>' +
      '<div class="todo-row__body">' +
        '<button type="button" class="todo-row__main" data-doc-open="' + todo.id + '">' +
          '<span class="todo-row__title">' + escapeHtml(todo.title) + '</span>' +
          (todo.notes ? '<span class="todo-row__notes">' + escapeHtml(todo.notes) + '</span>' : '') +
          (subtasks.length ? '<span class="todo-row__subtask-progress">' + doneSubtasks + '/' + subtasks.length + ' subtasks completed</span>' : '') +
          '<span class="todo-row__meta">' +
            '<span class="todo-row__due todo-row__due--slate"><i class="bi bi-check2"></i>Completed ' + escapeHtml(timeAgo(todo.completedAt) || '') + '</span>' +
            todoMoneyBadge(todo) +
            ((todo.documents || []).length ? '<span class="todo-row__doc-count"><i class="bi bi-paperclip"></i>' + todo.documents.length + '</span>' : '') +
          '</span>' +
        '</button>' +
        (links.length ? '<div class="todo-row__links">' + linkChipsHtml + '</div>' : '') +
      '</div>' +
    '</div>';
}

function renderDocumentationFilterBar() {
  const all = getCompletedTodos();
  const filters = [
    ['all', 'All', all.length],
    ['week', 'This week', all.filter(t => matchesDocumentationFilter(t, 'week')).length],
    ['month', 'This month', all.filter(t => matchesDocumentationFilter(t, 'month')).length],
    ['money', 'Had money', all.filter(t => matchesDocumentationFilter(t, 'money')).length],
    ['linked', 'Linked', all.filter(t => matchesDocumentationFilter(t, 'linked')).length],
  ];
  documentationFilterBar.innerHTML = filters.map(([key, label, count]) =>
    '<button type="button" class="todo-filter-chip' + (documentationActiveFilter === key ? ' is-active' : '') + '" data-doc-filter="' + key + '">' +
      label + '<span class="chip-count">' + count + '</span>' +
    '</button>'
  ).join('');
}

function renderDocumentation() {
  renderDocumentationFilterBar();

  const term = documentationSearchTerm.trim().toLowerCase();
  const visible = getCompletedTodos()
    .filter(t => matchesDocumentationFilter(t, documentationActiveFilter))
    .filter(t => matchesDocumentationSearch(t, term));

  if (visible.length === 0) {
    documentationListEl.innerHTML = '';
    documentationEmptyState.classList.remove('d-none');
  } else {
    documentationEmptyState.classList.add('d-none');
    documentationListEl.innerHTML = visible.map(documentationRow).join('');
  }
}

documentationFilterBar.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-doc-filter]');
  if (!chip) return;
  documentationActiveFilter = chip.dataset.docFilter;
  renderDocumentation();
});

let documentationSearchDebounce;
documentationSearchInput.addEventListener('input', (e) => {
  clearTimeout(documentationSearchDebounce);
  documentationSearchDebounce = setTimeout(() => { documentationSearchTerm = e.target.value; renderDocumentation(); }, 150);
});

documentationListEl.addEventListener('click', (e) => {
  const rowLinkBtn = e.target.closest('[data-row-link]');
  if (rowLinkBtn) {
    const rowEl = rowLinkBtn.closest('.todo-row');
    const todo = getTodos().find(t => t.id === rowEl.dataset.id);
    const link = todo && (todo.links || [])[Number(rowLinkBtn.dataset.rowLink)];
    if (link) openLinkDetails(link);
    return;
  }
  const openBtn = e.target.closest('[data-doc-open]');
  if (openBtn) openTodoModal(openBtn.dataset.docOpen); // same editor as To-Do; unchecking "done" brings it back
});
