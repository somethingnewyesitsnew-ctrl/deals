/* ============================================================
   projects.js
   ------------------------------------------------------------
   Delivery work: Web / Mobile / Systems / Consultation, plus
   Idea/Other for anything that doesn't fit — including work with
   no paying client yet. A project either carries a dealId (it
   was converted from a Won deal — see convertDealToProject() in
   deals-detail.js) or stands alone (dealId null, clientName
   free-typed for an external project).

   Tasks that belong to a project are ordinary `todos` rows
   linked via the universal `links` array (type='project') — see
   links.js — not stored on the project itself. Phases/milestones
   ARE stored on the project (jsonb array), since they only ever
   make sense in the context of that one project.

   Exposes: renderProjects(), openProjectModal(id)
   ============================================================ */

const PROJECT_TYPE_META = {
  web: { icon: 'bi-globe', label: 'Web' },
  mobile: { icon: 'bi-phone', label: 'Mobile App' },
  systems: { icon: 'bi-cpu', label: 'Systems' },
  consultation: { icon: 'bi-chat-square-text', label: 'Consultation' },
  idea: { icon: 'bi-lightbulb', label: 'Idea' },
  other: { icon: 'bi-folder', label: 'Other' },
};

// A starting checklist of phases per project type — inserted with one
// click, then freely edited/reordered/renamed like any other phase.
const DEFAULT_PHASE_TEMPLATES = {
  web: ['Discovery', 'Design', 'Build', 'QA', 'Launch'],
  mobile: ['Discovery', 'Design', 'Build', 'QA', 'App Store Submission'],
  systems: ['Requirements', 'Development', 'Testing', 'Deployment'],
  consultation: ['Engagement'],
  idea: ['Exploration'],
  other: ['Planning', 'Execution', 'Delivery'],
};

const projectsTableBodyEl = document.getElementById('projectsTableBody');
const projectsEmptyState = document.getElementById('projectsEmptyState');
const projectsFilterBar = document.getElementById('projectsFilterBar');
const projectsSummaryEl = document.getElementById('projectsSummary');
const projMilestonesListEl = document.getElementById('projMilestonesList');

let projectsActiveFilter = 'active'; // 'active' | 'not_started' | 'on_hold' | 'delivered' | 'all'

function matchesProjectFilter(project, filter) {
  if (filter === 'all') return true;
  if (filter === 'active') return project.status === 'in_progress' || project.status === 'not_started';
  return project.status === filter;
}

function projectPhaseProgress(project) {
  const phases = project.phases || [];
  const done = phases.filter(p => p.status === 'done').length;
  return { done, total: phases.length, pct: phases.length ? Math.round((done / phases.length) * 100) : 0 };
}

function renderProjectsFilterBar(all) {
  const filters = [
    ['active', 'Active', all.filter(p => matchesProjectFilter(p, 'active')).length],
    ['not_started', 'Not started', all.filter(p => p.status === 'not_started').length],
    ['on_hold', 'On hold', all.filter(p => p.status === 'on_hold').length],
    ['delivered', 'Delivered', all.filter(p => p.status === 'delivered' || p.status === 'completed').length],
    ['all', 'All', all.length],
  ];
  projectsFilterBar.innerHTML = filters.map(([key, label, count]) =>
    '<button type="button" class="todo-filter-chip' + (projectsActiveFilter === key ? ' is-active' : '') + '" data-project-filter="' + key + '">' +
      label + '<span class="chip-count">' + count + '</span>' +
    '</button>'
  ).join('');
}

// Table row — ported from the mockup's project table: name+type stacked,
// a status chip with a progress bar underneath it (not a separate
// column), a lead "avatar" initial, and budget in the deal's dual
// currency. Every project has a real "lead" here since this is a
// single-person shop — shown as your own initial, matching the
// mockup's per-row assignee avatar without needing a team/user system.
function projectTableRow(project) {
  const typeMeta = PROJECT_TYPE_META[project.type] || PROJECT_TYPE_META.other;
  const progress = projectPhaseProgress(project);
  const deal = project.dealId ? getDeals().find(d => d.id === project.dealId) : null;
  const clientLabel = deal ? (deal.entityName || 'Untitled entity') : project.clientName;
  const budgetHtml = deal ? formatDualCurrency(deal.value, deal.currency) : '<span class="no-referral">—</span>';

  return '' +
    '<tr class="row-clickable" data-open-project="' + project.id + '">' +
      '<td>' +
        '<span class="deal-name">' + escapeHtml(project.name) + '</span>' +
        '<div class="deal-meta"><span class="type-word">' + typeMeta.label + '</span>' + (clientLabel ? ' <span class="meta-dot">·</span> ' + escapeHtml(clientLabel) : '') + '</div>' +
      '</td>' +
      '<td class="proj-progress-cell">' +
        '<span class="dev-status-badge dev-status-badge--' + WORK_STATUS_TONE[project.status] + '">' + WORK_STATUS_LABELS[project.status] + '</span>' +
        (progress.total
          ? '<div class="proj-progress-bar" title="' + progress.done + '/' + progress.total + ' phases"><div class="proj-progress-bar__fill" style="width:' + progress.pct + '%"></div></div>'
          : '<span class="no-referral proj-progress-none">No phases set</span>') +
      '</td>' +
      '<td><span class="proj-lead-avatar" title="You"><i class="bi bi-person-fill"></i></span></td>' +
      '<td class="text-end deal-value">' + budgetHtml + '</td>' +
      '<td><i class="bi bi-chevron-right" style="color:var(--text-faint)"></i></td>' +
    '</tr>';
}

// Recent Milestones (sidebar) — every project's most recently completed
// or in-progress phase, most recent first; a compact activity feed
// version of what the project cards used to show individually.
function renderProjMilestones(all) {
  if (!projMilestonesListEl) return;
  const events = [];
  all.forEach(p => {
    (p.phases || []).forEach(phase => {
      if (phase.status === 'done' || phase.status === 'in_progress') {
        events.push({ project: p, phase, order: phase.status === 'done' ? 1 : 0 });
      }
    });
  });
  // No per-phase timestamp exists — order by the project's own updatedAt
  // (most recently touched project surfaces its milestones first), done
  // phases ahead of in-progress ones within that.
  events.sort((a, b) => (b.project.updatedAt || 0) - (a.project.updatedAt || 0) || b.order - a.order);

  if (events.length === 0) {
    projMilestonesListEl.innerHTML = '<p class="chart-empty" style="padding:0.5rem 0;">No phases logged yet.</p>';
    return;
  }

  projMilestonesListEl.innerHTML = events.slice(0, 8).map(ev => '' +
    '<button type="button" class="proj-milestone" data-open-project="' + ev.project.id + '">' +
      '<span class="proj-milestone__dot proj-milestone__dot--' + (ev.phase.status === 'done' ? 'done' : 'active') + '"></span>' +
      '<span class="proj-milestone__body">' +
        '<span class="proj-milestone__title">' + escapeHtml(ev.phase.name) + '</span>' +
        '<span class="proj-milestone__sub">' + escapeHtml(ev.project.name) + ' · ' + (ev.phase.status === 'done' ? 'Completed' : 'In progress') + '</span>' +
      '</span>' +
    '</button>'
  ).join('');
}

function renderProjects() {
  const all = getProjects();

  const activeCount = all.filter(p => matchesProjectFilter(p, 'active')).length;
  const deliveredCount = all.filter(p => p.status === 'delivered' || p.status === 'completed').length;
  const noDealCount = all.filter(p => !p.dealId).length;
  projectsSummaryEl.innerHTML = [
    ['Active projects', activeCount, 'bi-kanban', 'cyan'],
    ['Delivered', deliveredCount, 'bi-check-circle', 'green'],
    ['External / no deal', noDealCount, 'bi-building', 'slate'],
    ['Total', all.length, 'bi-collection', 'slate'],
  ].map(([label, count, icon, tone]) =>
    '<div class="attention-stat attention-stat--' + tone + '">' +
      '<i class="bi ' + icon + '"></i>' +
      '<span class="attention-stat__figure">' + count + '</span>' +
      '<span class="attention-stat__label">' + label + '</span>' +
    '</div>'
  ).join('');

  renderProjectsFilterBar(all);
  renderProjMilestones(all);

  const visible = all.filter(p => matchesProjectFilter(p, projectsActiveFilter))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (visible.length === 0) {
    projectsTableBodyEl.innerHTML = '';
    projectsEmptyState.classList.remove('d-none');
  } else {
    projectsEmptyState.classList.add('d-none');
    projectsTableBodyEl.innerHTML = visible.map(projectTableRow).join('');
  }
}

projectsFilterBar.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-project-filter]');
  if (!chip) return;
  projectsActiveFilter = chip.dataset.projectFilter;
  renderProjects();
});

projectsTableBodyEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open-project]');
  if (btn) openProjectModal(btn.dataset.openProject);
});
projMilestonesListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open-project]');
  if (btn) openProjectModal(btn.dataset.openProject);
});

/* ============================================================
   Project modal — details, phases, documents, linked tasks
   ============================================================ */
const projectModalEl = document.getElementById('projectModal');
const projectModal = new bootstrap.Modal(projectModalEl);
const projectModalTitle = document.getElementById('projectModalTitle');
const projectIdInput = document.getElementById('projectId');
const projectNameInput = document.getElementById('projectName');
const projectTypeInput = document.getElementById('projectType');
const projectStatusInput = document.getElementById('projectStatus');
const projectClientNameInput = document.getElementById('projectClientName');
const projectClientNameRow = document.getElementById('projectClientNameRow');
const projectDealBadgeRow = document.getElementById('projectDealBadgeRow');
const projectStartDateInput = document.getElementById('projectStartDate');
const projectTargetDateInput = document.getElementById('projectTargetDate');
const projectDescriptionInput = document.getElementById('projectDescription');
const projectDeleteBtn = document.getElementById('projectDeleteBtn');
const projectForm = document.getElementById('projectForm');

let currentProjectId = null;
let projectEditPhases = [];
let projectEditDocuments = [];
let projectConvertSourceDealId = null; // set by deals-detail.js's 'Convert to project' action

const projectLinkPicker = createLinkPicker({
  container: document.getElementById('projectLinkPickerContainer'),
  chipsEl: document.getElementById('projectLinkChips'),
});

// ---------- Phases ----------
const projectPhaseInput = document.getElementById('projectPhaseInput');
const projectPhaseAddBtn = document.getElementById('projectPhaseAddBtn');
const projectPhaseList = document.getElementById('projectPhaseList');
const projectPhaseTemplateBtn = document.getElementById('projectPhaseTemplateBtn');

const PHASE_STATUS_CYCLE = ['not_started', 'in_progress', 'done'];
const PHASE_STATUS_ICON = { not_started: 'bi-circle', in_progress: 'bi-circle-half', done: 'bi-check-circle-fill' };

function renderProjectPhaseList() {
  if (projectEditPhases.length === 0) {
    projectPhaseList.innerHTML = '<li class="comm-log-empty-msg">No phases yet — add one, or use a starting template for this project type.</li>';
    return;
  }
  projectPhaseList.innerHTML = projectEditPhases.map(p =>
    '<li class="subtask-item' + (p.status === 'done' ? ' subtask-item--done' : '') + '" data-id="' + p.id + '">' +
      '<button type="button" class="subtask-item__check" data-phase-cycle="' + p.id + '" title="Cycle status"><i class="bi ' + PHASE_STATUS_ICON[p.status] + '"></i></button>' +
      '<span class="subtask-item__text">' + escapeHtml(p.name) + '</span>' +
      '<button type="button" class="subtask-item__remove" data-phase-remove="' + p.id + '" aria-label="Remove phase"><i class="bi bi-x-lg"></i></button>' +
    '</li>'
  ).join('');
}

function addPhase(name) {
  name = (name || '').trim();
  if (!name) return;
  projectEditPhases.push({ id: crypto.randomUUID(), name, status: 'not_started' });
  renderProjectPhaseList();
}

projectPhaseAddBtn.addEventListener('click', () => {
  addPhase(projectPhaseInput.value);
  projectPhaseInput.value = '';
});
projectPhaseInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addPhase(projectPhaseInput.value); projectPhaseInput.value = ''; }
});

projectPhaseTemplateBtn.addEventListener('click', () => {
  const template = DEFAULT_PHASE_TEMPLATES[projectTypeInput.value] || [];
  template.forEach(name => {
    if (!projectEditPhases.some(p => p.name.toLowerCase() === name.toLowerCase())) addPhase(name);
  });
});

projectPhaseList.addEventListener('click', (e) => {
  const cycleBtn = e.target.closest('[data-phase-cycle]');
  if (cycleBtn) {
    const phase = projectEditPhases.find(p => p.id === cycleBtn.dataset.phaseCycle);
    if (phase) {
      const idx = PHASE_STATUS_CYCLE.indexOf(phase.status);
      phase.status = PHASE_STATUS_CYCLE[(idx + 1) % PHASE_STATUS_CYCLE.length];
    }
    renderProjectPhaseList();
    return;
  }
  const removeBtn = e.target.closest('[data-phase-remove]');
  if (removeBtn) {
    projectEditPhases = projectEditPhases.filter(p => p.id !== removeBtn.dataset.phaseRemove);
    renderProjectPhaseList();
  }
});

// ---------- Documents (same pattern as the To-Do modal) ----------
const projectDocFile = document.getElementById('projectDocFile');
const projectDocUrl = document.getElementById('projectDocUrl');
const projectDocAddBtn = document.getElementById('projectDocAddBtn');
const projectDocList = document.getElementById('projectDocList');
const PROJECT_MAX_DOC_BYTES = 350 * 1024;

function renderProjectDocList() {
  if (projectEditDocuments.length === 0) {
    projectDocList.innerHTML = '<p class="no-referral">No documents attached yet.</p>';
    return;
  }
  projectDocList.innerHTML = projectEditDocuments.map(doc => '' +
    '<div class="document-row">' +
      '<span class="document-row__main">' +
        '<i class="bi ' + (doc.kind === 'link' ? 'bi-link-45deg' : 'bi-file-earmark') + ' document-row__icon"></i>' +
        '<span class="document-row__name">' + escapeHtml(doc.name) + '</span>' +
        '<span class="document-row__meta">' + (doc.kind === 'link' ? 'Link' : formatBytesShort(doc.size)) + '</span>' +
      '</span>' +
      '<button type="button" class="document-row__remove" data-project-doc-remove="' + doc.id + '" aria-label="Remove document"><i class="bi bi-trash3"></i></button>' +
    '</div>'
  ).join('');
}

projectDocAddBtn.addEventListener('click', () => {
  const file = projectDocFile.files[0];
  const url = projectDocUrl.value.trim();
  if (!file && !url) { showToast('Attach a file or paste a link first.'); return; }
  if (file && file.size > PROJECT_MAX_DOC_BYTES) {
    showToast('That file is ' + formatBytesShort(file.size) + ' — capped around 350KB here. Use a link for anything bigger.');
    return;
  }
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      projectEditDocuments.push({ id: crypto.randomUUID(), name: file.name, kind: 'file', dataUrl: reader.result, mimeType: file.type, size: file.size, addedAt: Date.now() });
      projectDocFile.value = '';
      renderProjectDocList();
    };
    reader.readAsDataURL(file);
  } else {
    projectEditDocuments.push({ id: crypto.randomUUID(), name: url, kind: 'link', url, addedAt: Date.now() });
    projectDocUrl.value = '';
    renderProjectDocList();
  }
});

projectDocList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-project-doc-remove]');
  if (!btn) return;
  projectEditDocuments = projectEditDocuments.filter(d => d.id !== btn.dataset.projectDocRemove);
  renderProjectDocList();
});

// ---------- Linked tasks (read-only list + quick add) ----------
const projectTasksList = document.getElementById('projectTasksList');
const projectAddTaskBtn = document.getElementById('projectAddTaskBtn');

function renderProjectTasksList() {
  if (!currentProjectId) { projectTasksList.innerHTML = '<p class="no-referral">Save the project first to attach tasks.</p>'; return; }
  const tasks = getTodos().filter(t => (t.links || []).some(l => l.type === 'project' && l.id === currentProjectId));
  if (tasks.length === 0) {
    projectTasksList.innerHTML = '<p class="no-referral">No tasks linked yet.</p>';
    return;
  }
  projectTasksList.innerHTML = '<div class="attention-list">' + tasks.map(t =>
    '<button type="button" class="attention-row" data-open-task="' + t.id + '">' +
      '<span class="attention-row__name">' + escapeHtml(t.title) + '</span>' +
      (t.status === 'done' ? '<span class="status-badge status-badge--done">Done</span>' : (t.dueDate ? '<span class="attention-row__context">' + escapeHtml(relativeDayLabel(t.dueDate)) + '</span>' : '')) +
      '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
    '</button>'
  ).join('') + '</div>';
}

projectTasksList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open-task]');
  if (!btn) return;
  projectModal.hide();
  switchView('todos');
  openTodoModal(btn.dataset.openTask);
});

projectAddTaskBtn.addEventListener('click', () => {
  if (!currentProjectId) { showToast('Save the project first, then add tasks.'); return; }
  const project = getProjects().find(p => p.id === currentProjectId);
  projectModal.hide();
  openTodoModal(); // fresh task; user links it back via the To-Do modal's own link picker
  showToast('Link this task to "' + (project ? project.name : 'the project') + '" using the Linked to field.');
});

// ---------- Open / save / delete ----------
function openProjectModal(id) {
  const existing = id ? getProjects().find(p => p.id === id) : null;
  currentProjectId = existing ? existing.id : null;
  projectConvertSourceDealId = null;

  projectEditPhases = existing ? (existing.phases || []).map(p => Object.assign({}, p)) : [];
  projectEditDocuments = existing ? (existing.documents || []).slice() : [];

  const deal = existing && existing.dealId ? getDeals().find(d => d.id === existing.dealId) : null;

  if (existing) {
    projectModalTitle.textContent = 'Edit project';
    projectIdInput.value = existing.id;
    projectNameInput.value = existing.name || '';
    projectTypeInput.value = existing.type || 'web';
    projectStatusInput.value = existing.status || 'not_started';
    projectClientNameInput.value = existing.clientName || '';
    projectStartDateInput.value = existing.startDate || '';
    projectTargetDateInput.value = existing.targetDate || '';
    projectDescriptionInput.value = existing.description || '';
    projectDeleteBtn.classList.remove('d-none');
  } else {
    projectModalTitle.textContent = 'New project';
    projectIdInput.value = '';
    projectNameInput.value = '';
    projectTypeInput.value = 'web';
    projectStatusInput.value = 'not_started';
    projectClientNameInput.value = '';
    projectStartDateInput.value = '';
    projectTargetDateInput.value = '';
    projectDescriptionInput.value = '';
    projectDeleteBtn.classList.add('d-none');
  }

  if (deal) {
    projectDealBadgeRow.innerHTML = '<span class="link-chip"><i class="bi bi-journal-text"></i>' + escapeHtml(deal.entityName || 'Untitled entity') + '</span> <span class="dropdown-hint d-inline">converted from this deal</span>';
    projectDealBadgeRow.classList.remove('d-none');
    projectClientNameRow.classList.add('d-none');
  } else {
    projectDealBadgeRow.classList.add('d-none');
    projectClientNameRow.classList.remove('d-none');
  }

  projectLinkPicker.reset();
  projectLinkPicker.setLinks(existing ? existing.links || [] : []);
  renderProjectPhaseList();
  renderProjectDocList();
  renderProjectTasksList();

  projectModal.show();
  setTimeout(() => projectNameInput.focus(), 200);
}

projectForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = projectNameInput.value.trim();
  if (!name) { projectNameInput.focus(); return; }

  const existingId = projectIdInput.value;
  const existing = existingId ? getProjects().find(p => p.id === existingId) : null;

  const wasEdit = Boolean(existingId);
  saveProject({
    id: existingId || undefined,
    name,
    type: projectTypeInput.value,
    status: projectStatusInput.value,
    dealId: existing ? existing.dealId : (projectConvertSourceDealId || null),
    clientName: projectClientNameInput.value.trim(),
    description: projectDescriptionInput.value.trim(),
    startDate: projectStartDateInput.value,
    targetDate: projectTargetDateInput.value,
    phases: projectEditPhases,
    documents: projectEditDocuments,
    links: projectLinkPicker.getLinks(),
  });

  projectModal.hide();
  projectConvertSourceDealId = null;
  renderProjects();
  if (typeof updateTabCounts === 'function') updateTabCounts();
  showToast(wasEdit ? 'Project updated.' : 'Project created.');
});

projectDeleteBtn.addEventListener('click', () => {
  const id = projectIdInput.value;
  if (!id) return;
  if (!confirm('Delete this project? Linked tasks/documents/expenses stay put, just unlinked. This can\'t be undone.')) return;
  deleteProject(id);
  projectModal.hide();
  renderProjects();
  if (typeof updateTabCounts === 'function') updateTabCounts();
  showToast('Project deleted.');
});

// Entry point used by the FAB speed-dial.
function openNewProjectModal() { openProjectModal(); }
