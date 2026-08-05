/* ============================================================
   updates.js
   ------------------------------------------------------------
   "Updates" are NOT a separate stored thing — they're entries in
   a deal's existing commLog array (see storage.js / README data
   model), just added through a one-field-focused quick form
   instead of the full wizard step. This file owns:
     - status labels/badges (scheduled/done/canceled/rescheduled/note)
     - entryDateKey() — turns a comm log entry's datetime into a
       plain YYYY-MM-DD key, used by calendar.js to place it on a day
     - the Quick Update modal, opened from a table row's "+" button
       or from the detail view's "Add update" button

   Exposes: STATUS_LABELS, statusBadge(status), entryDateKey(entry),
            openQuickUpdateModal(dealId)
   ============================================================ */

const STATUS_LABELS = {
  scheduled: 'Scheduled', done: 'Done', canceled: 'Canceled',
  rescheduled: 'Rescheduled', note: 'Note',
};

function statusBadge(status) {
  if (!status || !STATUS_LABELS[status]) return '';
  return '<span class="status-badge status-badge--' + status + '">' + STATUS_LABELS[status] + '</span>';
}

// A comm log entry's datetime is either a bare date ("2026-07-22", from the
// quick-update form) or a datetime-local value ("2026-07-22T09:00", from the
// full wizard). Either way the calendar just needs the date portion — sliced
// directly rather than round-tripped through Date/toISOString, which would
// shift dates near midnight depending on the browser's timezone.
function entryDateKey(entry) {
  if (!entry || !entry.datetime) return null;
  return entry.datetime.split('T')[0];
}

// "Today" / "Tomorrow" / "Wednesday" / "Last Monday" / falls back to a plain
// date once it's more than a week out either direction.
function relativeDayLabel(dateKey) {
  if (!dateKey) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateKey + 'T00:00:00');
  const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  if (diffDays < -1 && diffDays > -7) return 'Last ' + d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// A next-step date is optional on every update (deal comm-log entry or
// contact update). When set, classifies it the same way close dates and
// invoice due dates already are elsewhere in the app — 'overdue' / 'soon'
// (within 7 days) / 'later' / null (no date, or already done/canceled).
const FOLLOWUP_SOON_DAYS = 7;

function followUpState(entry) {
  if (!entry || !entry.nextStepDate) return null;
  if (entry.status === 'done' || entry.status === 'canceled') return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = (new Date(entry.nextStepDate + 'T00:00:00') - new Date(new Date().toDateString())) / dayMs;
  if (diffDays < 0) return 'overdue';
  if (diffDays <= FOLLOWUP_SOON_DAYS) return 'soon';
  return 'later';
}

// Every deal comm-log entry with an actionable next-step date, tagged with
// which deal it belongs to.
function collectDealFollowUps() {
  const out = [];
  getDeals().forEach(deal => {
    (deal.commLog || []).forEach(entry => {
      const state = followUpState(entry);
      if (state) out.push({ deal, entry, state });
    });
  });
  return out;
}

// Same, but for contact-level updates (see storage.js's contact-updates
// functions) — resolves the contactKey back to a display name via the
// entry's own snapshot rather than re-grouping deals.
function collectContactFollowUps() {
  const out = [];
  getAllContactUpdatesFlat().forEach(entry => {
    const state = followUpState(entry);
    if (state) out.push({ contactKey: entry.contactKey, contactName: entry.contactName || entry.contactKey.split('|')[0], entry, state });
  });
  return out;
}


// ---------- Quick Update modal ----------
const quickUpdateModalEl = document.getElementById('quickUpdateModal');
const quickUpdateModal = new bootstrap.Modal(quickUpdateModalEl);
const quickUpdateForm = document.getElementById('quickUpdateForm');
const quickUpdateDealIdInput = document.getElementById('quickUpdateDealId');
const quickUpdateEntityName = document.getElementById('quickUpdateEntityName');
const quickUpdateDate = document.getElementById('quickUpdateDate');
const quickUpdateStatus = document.getElementById('quickUpdateStatus');
const quickUpdateType = document.getElementById('quickUpdateType');
const quickUpdateNextStep = document.getElementById('quickUpdateNextStep');
const quickUpdateNextStepDate = document.getElementById('quickUpdateNextStepDate');
const quickUpdateText = document.getElementById('quickUpdateText');

function openQuickUpdateModal(dealId, prefillDate) {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;

  quickUpdateDealIdInput.value = dealId;
  quickUpdateEntityName.textContent = deal.entityName || 'Untitled entity';
  quickUpdateDate.value = prefillDate || new Date().toISOString().slice(0, 10);
  quickUpdateStatus.value = 'scheduled';
  quickUpdateType.value = '';
  quickUpdateNextStep.value = '';
  quickUpdateNextStepDate.value = '';
  quickUpdateText.value = '';
  quickUpdateModal.show();
  setTimeout(() => quickUpdateText.focus(), 200);
}

quickUpdateForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const dealId = quickUpdateDealIdInput.value;
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;

  const text = quickUpdateText.value.trim();
  const type = quickUpdateType.value.trim();
  const nextStep = quickUpdateNextStep.value.trim();
  const nextStepDate = quickUpdateNextStepDate.value;
  const status = quickUpdateStatus.value;

  // Every field is optional, but an update with nothing in it isn't worth
  // logging — require at least one of them to be filled in.
  if (!text && !type && !nextStep && !nextStepDate && !status) {
    quickUpdateText.focus();
    return;
  }

  const entry = {
    id: crypto.randomUUID(),
    datetime: quickUpdateDate.value || '',
    channel: type, action: '', nextStep,
    nextStepDate,
    note: text,
    status,
  };

  if (type) addOption('channel', type);
  if (nextStep) addOption('nextstep', nextStep);
  refreshAllDatalists();

  const commLog = (deal.commLog || []).slice();
  commLog.push(entry);
  saveDeal({ id: deal.id, commLog });

  quickUpdateModal.hide();
  renderEverything();

  // If the detail popup for this exact deal happens to be open, refresh its
  // content in place — but never force it open if it wasn't already.
  if (typeof currentDetailDealId !== 'undefined' && currentDetailDealId === dealId &&
      detailModalEl.classList.contains('show')) {
    openDetailModal(dealId);
  }

  showToast('Update added.');
});

// ---------- Contact Update modal ----------
// Same shape of entry as a deal's comm log (date, type, status, next step +
// next step date, note), just stored under a contact identity instead of a
// deal id (see storage.js's contact-updates functions). Shows the running
// list right in the modal since contacts don't have their own detail page.
const contactUpdateModalEl = document.getElementById('contactUpdateModal');
const contactUpdateModal = new bootstrap.Modal(contactUpdateModalEl);
const contactUpdateNameEl = document.getElementById('contactUpdateName');
const contactUpdateList = document.getElementById('contactUpdateList');
const cuDate = document.getElementById('cuDate');
const cuType = document.getElementById('cuType');
const cuStatus = document.getElementById('cuStatus');
const cuNextStep = document.getElementById('cuNextStep');
const cuNextStepDate = document.getElementById('cuNextStepDate');
const cuNote = document.getElementById('cuNote');
const addContactUpdateBtn = document.getElementById('addContactUpdateBtn');

let currentContactKey = null;
let currentContactName = '';

function renderContactUpdateList() {
  const entries = getContactUpdates(currentContactKey);
  if (!entries.length) {
    contactUpdateList.innerHTML = '<li class="comm-log-empty-msg">No updates logged yet.</li>';
    return;
  }
  const sorted = entries.slice().sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
  contactUpdateList.innerHTML = sorted.map(entry => {
    const when = entry.datetime
      ? new Date(entry.datetime + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'No date';
    const chipBits = [];
    if (entry.channel) chipBits.push('<span class="comm-chip comm-chip--channel"><i class="bi bi-broadcast"></i>' + escapeHtml(entry.channel) + '</span>');
    if (entry.nextStep) chipBits.push('<span class="comm-chip comm-chip--next"><i class="bi bi-arrow-right-circle"></i>' + escapeHtml(entry.nextStep) + (entry.nextStepDate ? ' · ' + escapeHtml(relativeDayLabel(entry.nextStepDate)) : '') + '</span>');

    return '<li class="comm-log-item" data-id="' + entry.id + '">' +
      '<div class="comm-log-item__main">' +
        '<span class="comm-log-item__date">' + escapeHtml(when) + '</span>' +
        (entry.status ? statusBadge(entry.status) : '') +
        '<div class="comm-chips">' + chipBits.join('') + '</div>' +
        (entry.note ? '<div class="comm-log-item__note">' + escapeHtml(entry.note) + '</div>' : '') +
      '</div>' +
      '<button type="button" class="comm-log-item__remove" aria-label="Remove entry"><i class="bi bi-x-lg"></i></button>' +
    '</li>';
  }).join('');
}

// Called by contacts.js when someone clicks a contact row's update button.
function openContactUpdateModal(contactKey, contactName) {
  currentContactKey = contactKey;
  currentContactName = contactName;
  contactUpdateNameEl.textContent = contactName;
  cuDate.value = new Date().toISOString().slice(0, 10);
  cuType.value = '';
  cuStatus.value = '';
  cuNextStep.value = '';
  cuNextStepDate.value = '';
  cuNote.value = '';
  renderContactUpdateList();
  contactUpdateModal.show();
}

addContactUpdateBtn.addEventListener('click', () => {
  if (!currentContactKey) return;

  const type = cuType.value.trim();
  const status = cuStatus.value;
  const nextStep = cuNextStep.value.trim();
  const nextStepDate = cuNextStepDate.value;
  const note = cuNote.value.trim();

  if (!type && !status && !nextStep && !nextStepDate && !note) {
    cuNote.focus();
    return;
  }

  addContactUpdate(currentContactKey, {
    datetime: cuDate.value || '',
    channel: type,
    status,
    nextStep,
    nextStepDate,
    note,
    contactName: currentContactName,
  });

  if (type) addOption('channel', type);
  if (nextStep) addOption('nextstep', nextStep);
  refreshAllDatalists();

  cuType.value = '';
  cuStatus.value = '';
  cuNextStep.value = '';
  cuNextStepDate.value = '';
  cuNote.value = '';

  renderContactUpdateList();
  renderEverything();
  showToast('Update added.');
});

contactUpdateList.addEventListener('click', (e) => {
  const btn = e.target.closest('.comm-log-item__remove');
  if (!btn || !currentContactKey) return;
  const id = btn.closest('.comm-log-item').dataset.id;
  deleteContactUpdate(currentContactKey, id);
  renderContactUpdateList();
  renderEverything();
});
