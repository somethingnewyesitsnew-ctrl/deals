/* ============================================================
   deals-wizard.js
   ------------------------------------------------------------
   The "New deal" / edit-pencil popup only: the 4-step form, its
   navigation, the communications-log editor inside step 4, entity
   autofill/duplicate-prevention, and saving.

   Exposes: openWizard(dealId)
   ============================================================ */

// ---------- DOM refs ----------
const dealModalEl = document.getElementById('dealModal');
const dealModal = new bootstrap.Modal(dealModalEl);
const modalIndexLabel = document.getElementById('modalIndexLabel');
const modalTitleLabel = document.getElementById('modalTitleLabel');
const wizardSteps = document.getElementById('wizardSteps');
const wizardBackBtn = document.getElementById('wizardBackBtn');
const wizardNextBtn = document.getElementById('wizardNextBtn');
const wizardSaveBtn = document.getElementById('wizardSaveBtn');
const modalDeleteBtn = document.getElementById('modalDeleteBtn');
const jumpReferralsLink = document.getElementById('jumpReferralsLink');
const dealForm = document.getElementById('dealForm');
const dealIdInput = document.getElementById('dealId');

const commDateTime = document.getElementById('commDateTime');
const commChannel = document.getElementById('commChannel');
const commAction = document.getElementById('commAction');
const commNextStep = document.getElementById('commNextStep');
const commStatus = document.getElementById('commStatus');
const commNextStepDate = document.getElementById('commNextStepDate');
const commNote = document.getElementById('commNote');
const addCommBtn = document.getElementById('addCommBtn');
const commLogList = document.getElementById('commLogList');

// ---------- State ----------
const TOTAL_STEPS = 4;
let currentStep = 1;
let commLogEntries = [];
let paymentBreakdown = [];

const pbLabelInput = document.getElementById('pbLabel');
const pbPercentInput = document.getElementById('pbPercent');
const pbAmountPreviewEl = document.getElementById('pbAmountPreview');
const addPaymentBreakdownBtn = document.getElementById('addPaymentBreakdownBtn');
const paymentBreakdownList = document.getElementById('paymentBreakdownList');
const paymentBreakdownTotalHint = document.getElementById('paymentBreakdownTotalHint');
const dealValueInput = document.getElementById('dealValue');

// ---------- Field helpers (wizard-only — table/detail read deal objects directly) ----------
function val(id) { return document.getElementById(id).value.trim(); }
function setVal(id, v) { document.getElementById(id).value = (v === undefined || v === null) ? '' : v; }
function radioVal(name) {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : '';
}
function setRadio(name, value) {
  document.querySelectorAll('input[name="' + name + '"]').forEach(el => { el.checked = el.value === value; });
}

// ================= Wizard navigation =================
function goToStep(step) {
  currentStep = Math.min(Math.max(step, 1), TOTAL_STEPS);

  dealModalEl.querySelectorAll('.wizard-pane').forEach(pane => {
    pane.classList.toggle('d-none', Number(pane.dataset.pane) !== currentStep);
  });
  wizardSteps.querySelectorAll('.wizard-step').forEach(btn => {
    const n = Number(btn.dataset.step);
    btn.classList.toggle('is-active', n === currentStep);
    btn.classList.toggle('is-complete', n < currentStep);
  });

  wizardBackBtn.classList.toggle('d-none', currentStep === 1);
  wizardNextBtn.classList.toggle('d-none', currentStep === TOTAL_STEPS);
  wizardSaveBtn.classList.toggle('d-none', currentStep !== TOTAL_STEPS);
}

wizardNextBtn.addEventListener('click', () => goToStep(currentStep + 1));
wizardBackBtn.addEventListener('click', () => goToStep(currentStep - 1));
wizardSteps.addEventListener('click', (e) => {
  const btn = e.target.closest('.wizard-step');
  if (!btn) return;
  goToStep(Number(btn.dataset.step));
});

jumpReferralsLink.addEventListener('click', () => {
  const name = val('refName');
  dealModal.hide();
  switchView('referrals', { searchTerm: name || '' });
});

// ================= Communications log (step 4 editor) =================
function renderCommLog() {
  if (commLogEntries.length === 0) {
    commLogList.innerHTML = '<li class="comm-log-empty-msg">No log entries yet.</li>';
    return;
  }
  const sorted = commLogEntries.slice().sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
  commLogList.innerHTML = sorted.map(entry => {
    const when = entry.datetime
      ? new Date(entry.datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'No date';
    const chipBits = [];
    if (entry.channel) chipBits.push('<span class="comm-chip comm-chip--channel"><i class="bi bi-broadcast"></i>' + escapeHtml(entry.channel) + '</span>');
    if (entry.action) chipBits.push('<span class="comm-chip comm-chip--action"><i class="bi bi-check2-circle"></i>' + escapeHtml(entry.action) + '</span>');
    if (entry.nextStep) chipBits.push('<span class="comm-chip comm-chip--next"><i class="bi bi-arrow-right-circle"></i>' + escapeHtml(entry.nextStep) + (entry.nextStepDate ? ' · ' + escapeHtml(relativeDayLabel(entry.nextStepDate)) : '') + '</span>');

    return '<li class="comm-log-item" data-id="' + entry.id + '">' +
      '<div class="comm-log-item__main">' +
        '<span class="comm-log-item__date">' + escapeHtml(when) + '</span>' +
        (entry.status ? ' ' + statusBadge(entry.status) : '') +
        '<div class="comm-chips">' + chipBits.join('') + '</div>' +
        (entry.note ? '<div class="comm-log-item__note">' + escapeHtml(entry.note) + '</div>' : '') +
      '</div>' +
      '<button type="button" class="comm-log-item__remove" aria-label="Remove entry"><i class="bi bi-x-lg"></i></button>' +
      '</li>';
  }).join('');
}

addCommBtn.addEventListener('click', () => {
  const channel = commChannel.value.trim();
  const action = commAction.value.trim();
  const nextStep = commNextStep.value.trim();
  const status = commStatus.value;
  const nextStepDate = commNextStepDate.value;
  const note = commNote.value.trim();

  if (!channel && !action && !nextStep && !note && !status && !nextStepDate) {
    commChannel.focus();
    return;
  }

  commLogEntries.push({
    id: crypto.randomUUID(),
    datetime: commDateTime.value || '',
    channel, action, nextStep, note, status, nextStepDate,
  });

  if (channel) addOption('channel', channel);
  if (action) addOption('action', action);
  if (nextStep) addOption('nextstep', nextStep);
  refreshAllDatalists();

  commDateTime.value = '';
  commChannel.value = '';
  commAction.value = '';
  commNextStep.value = '';
  commStatus.value = '';
  commNextStepDate.value = '';
  commNote.value = '';
  renderCommLog();
});

commLogList.addEventListener('click', (e) => {
  const btn = e.target.closest('.comm-log-item__remove');
  if (!btn) return;
  const id = btn.closest('.comm-log-item').dataset.id;
  commLogEntries = commLogEntries.filter(entry => entry.id !== id);
  renderCommLog();
});

// ================= Payment breakdown (Step 4) =================
// The whole point here is "no mental math": the % field always starts
// pre-filled with whatever's left (100% when nothing's added yet), every
// added line shows its money amount alongside its %, and the running
// "Remaining" hint always shows both the % and the amount still unallocated.
function currentDealValueAndCurrency() {
  return { value: Number(dealValueInput.value) || 0, currency: radioVal('dealCurrency') || 'USD' };
}

function updatePbAmountPreview() {
  const { value, currency } = currentDealValueAndCurrency();
  const percent = Number(pbPercentInput.value) || 0;
  if (!percent || !value) { pbAmountPreviewEl.textContent = ''; return; }
  const amount = Math.round((percent / 100) * value * 100) / 100;
  pbAmountPreviewEl.textContent = '≈ ' + formatInvoiceAmount(amount, currency);
}

function renderPaymentBreakdown() {
  const { value, currency } = currentDealValueAndCurrency();

  paymentBreakdownList.innerHTML = paymentBreakdown.map(pb => {
    const amount = Math.round((Number(pb.percent) / 100) * value * 100) / 100;
    return '<li class="payment-breakdown-item" data-id="' + pb.id + '">' +
      '<span class="payment-breakdown-item__label">' + escapeHtml(pb.label) + '</span>' +
      '<span class="payment-breakdown-item__percent">' + pb.percent + '%</span>' +
      '<span class="payment-breakdown-item__amount">' + formatInvoiceAmount(amount, currency) + '</span>' +
      '<button type="button" class="payment-breakdown-item__remove" aria-label="Remove"><i class="bi bi-x-lg"></i></button>' +
    '</li>';
  }).join('');

  const total = paymentBreakdown.reduce((s, pb) => s + (Number(pb.percent) || 0), 0);
  const remaining = Math.round((100 - total) * 100) / 100;

  if (paymentBreakdown.length === 0) {
    paymentBreakdownTotalHint.textContent = '';
  } else if (remaining > 0.001) {
    const remainingAmount = Math.round((remaining / 100) * value * 100) / 100;
    paymentBreakdownTotalHint.innerHTML = 'Remaining: <strong>' + remaining + '%</strong> (' + formatInvoiceAmount(remainingAmount, currency) + ')';
  } else if (Math.abs(remaining) <= 0.001) {
    paymentBreakdownTotalHint.innerHTML = '<span class="pb-hint-complete"><i class="bi bi-check-circle"></i> Fully allocated (100%)</span>';
  } else {
    paymentBreakdownTotalHint.innerHTML = '<span class="pb-hint-over">Over-allocated by ' + Math.abs(remaining) + '%</span>';
  }

  // Pre-fill the % field with whatever's left — adding the next line is then
  // just "type a label, click Add", no math required. Only skipped once
  // everything's allocated (nothing meaningful left to pre-fill).
  pbPercentInput.value = remaining > 0.001 ? remaining : '';
  updatePbAmountPreview();
}

addPaymentBreakdownBtn.addEventListener('click', () => {
  const label = pbLabelInput.value.trim();
  const percent = Number(pbPercentInput.value) || 0;
  if (!label || !percent) { pbLabelInput.focus(); return; }

  paymentBreakdown.push({ id: crypto.randomUUID(), label, percent });
  addOption('invoiceDescriptions', label);
  refreshAllDatalists();

  pbLabelInput.value = '';
  renderPaymentBreakdown();
});

pbPercentInput.addEventListener('input', updatePbAmountPreview);

// Entering/changing the deal value or currency refreshes every displayed
// amount (already-added lines + the remaining hint + the live preview) —
// and since "remaining" is always 100% when nothing's been added yet, this
// is also what makes the % field default to 100 the moment a value is typed.
dealValueInput.addEventListener('input', renderPaymentBreakdown);
document.getElementById('dealCurrencyUSD').addEventListener('change', renderPaymentBreakdown);
document.getElementById('dealCurrencySDG').addEventListener('change', renderPaymentBreakdown);

paymentBreakdownList.addEventListener('click', (e) => {
  const btn = e.target.closest('.payment-breakdown-item__remove');
  if (!btn) return;
  const id = btn.closest('.payment-breakdown-item').dataset.id;
  paymentBreakdown = paymentBreakdown.filter(pb => pb.id !== id);
  renderPaymentBreakdown();
});


// ================= Open wizard (new / edit) =================
function resetWizardForm() {
  dealForm.reset();
  dealIdInput.value = '';
  setRadio('dealCurrency', 'USD');
  commLogEntries = [];
  renderCommLog();
  paymentBreakdown = [];
  renderPaymentBreakdown();
  modalTitleLabel.textContent = 'New deal';
  modalIndexLabel.textContent = formatIndex(getNextEntryIndex());
  modalDeleteBtn.classList.add('d-none');
}

function fillWizardForm(deal) {
  dealIdInput.value = deal.id;

  setVal('entityName', deal.entityName);
  setVal('entityType', deal.entityType);
  setVal('fieldOfWork', deal.fieldOfWork);
  setVal('requirement', deal.requirement);
  setVal('scale', deal.scale);
  setRadio('firstTime', deal.firstTime);
  setVal('nationality', deal.nationality);
  setVal('currentLocation', deal.currentLocation);
  setVal('relationshipStatus', deal.relationshipStatus);
  setRadio('wouldWorkAgain', deal.wouldWorkAgain);
  setVal('reasonEnded', deal.reasonEnded);
  setVal('specialInstructions', deal.specialInstructions);
  setVal('relationshipNotes', deal.relationshipNotes);

  const fc = deal.firstContact || {};
  setVal('fcName', fc.name); setVal('fcNumber', fc.number); setVal('fcEmail', fc.email); setVal('fcRelation', fc.relation);

  const pm = deal.projectManager || {};
  setVal('pmName', pm.name); setVal('pmNumber', pm.number); setVal('pmEmail', pm.email); setVal('pmRelation', pm.relation);

  const ref = deal.referral || {};
  setVal('refName', ref.name); setVal('refNumber', ref.number); setVal('refEmail', ref.email); setVal('refRelation', ref.relation);
  setRadio('refFirstTime', ref.firstTime);
  setRadio('refPaidBefore', ref.paidBefore);

  setVal('dealValue', deal.value);
  setRadio('dealCurrency', deal.currency || 'USD');
  setVal('dealStage', deal.stage || 'new');
  setVal('dealWorkStatus', deal.workStatus);
  setVal('dealClose', deal.closeDate);
  setVal('dealNotes', deal.notes);

  commLogEntries = (deal.commLog || []).slice();
  renderCommLog();
  paymentBreakdown = (deal.paymentBreakdown || []).slice();
  renderPaymentBreakdown();
  setVal('dealServices', (deal.services || []).join(', '));

  modalTitleLabel.textContent = deal.entityName || 'Untitled entity';
  modalIndexLabel.textContent = formatIndex(deal.entryIndex);
  modalDeleteBtn.classList.remove('d-none');
}

// ================= Unsaved-changes guard =================
// Closing the modal (backdrop click, the header ×, Esc) used to silently
// discard whatever was typed. This snapshots the form right after it's
// populated (new or edit) and compares against that snapshot whenever
// Bootstrap is about to hide the modal — if they differ, confirm first.
// A real Save bypasses the check via wizardSkipDirtyCheck, set right
// before that handler's own dealModal.hide() call.
let wizardOpenSnapshot = '';
let wizardSkipDirtyCheck = false;

function serializeWizardForm() {
  const fd = new FormData(dealForm);
  const fields = [];
  for (const [key, value] of fd.entries()) fields.push(key + '=' + value);
  return fields.sort().join('&') + '||log:' + JSON.stringify(commLogEntries) + '||pb:' + JSON.stringify(paymentBreakdown);
}

function captureWizardSnapshot() {
  wizardOpenSnapshot = serializeWizardForm();
}

function isWizardDirty() {
  return serializeWizardForm() !== wizardOpenSnapshot;
}

dealModalEl.addEventListener('hide.bs.modal', (e) => {
  if (wizardSkipDirtyCheck) { wizardSkipDirtyCheck = false; return; }
  if (isWizardDirty() && !confirm('Discard unsaved changes to this deal?')) {
    e.preventDefault();
  }
});

function openWizard(dealId) {
  refreshAllDatalists();
  resetWizardForm();
  if (dealId) {
    const deal = getDeals().find(d => d.id === dealId);
    if (deal) fillWizardForm(deal);
  }
  goToStep(1);
  captureWizardSnapshot();
  dealModal.show();
}

// Autocomplete + duplicate prevention: typing an entity name we've already
// dealt with fills in its known details instead of re-asking for them.
// Only applies to new deals — never overwrites data while editing one.
document.getElementById('entityName').addEventListener('blur', () => {
  if (dealIdInput.value) return;
  const name = val('entityName');
  if (!name) return;
  const match = findLatestDealForEntity(name);
  if (!match) return;

  if (!val('entityType')) setVal('entityType', match.entityType);
  if (!val('fieldOfWork')) setVal('fieldOfWork', match.fieldOfWork);
  if (!val('requirement')) setVal('requirement', match.requirement);
  if (!val('scale')) setVal('scale', match.scale);
  if (!val('nationality')) setVal('nationality', match.nationality);
  if (!val('currentLocation')) setVal('currentLocation', match.currentLocation);
  if (!radioVal('firstTime')) setRadio('firstTime', 'no');
  showToast('Matched an existing entity — filled in what we already know.');
});

// ================= Save =================
dealForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const deal = {
    id: dealIdInput.value || undefined,
    entityName: val('entityName'),
    entityType: val('entityType'),
    fieldOfWork: val('fieldOfWork'),
    requirement: val('requirement'),
    scale: val('scale'),
    firstTime: radioVal('firstTime'),
    nationality: val('nationality'),
    currentLocation: val('currentLocation'),
    relationshipStatus: val('relationshipStatus'),
    wouldWorkAgain: radioVal('wouldWorkAgain'),
    reasonEnded: val('reasonEnded'),
    specialInstructions: val('specialInstructions'),
    relationshipNotes: val('relationshipNotes'),

    firstContact: { name: val('fcName'), number: val('fcNumber'), email: val('fcEmail'), relation: val('fcRelation') },
    projectManager: { name: val('pmName'), number: val('pmNumber'), email: val('pmEmail'), relation: val('pmRelation') },
    referral: {
      name: val('refName'), number: val('refNumber'), email: val('refEmail'), relation: val('refRelation'),
      firstTime: radioVal('refFirstTime'), paidBefore: radioVal('refPaidBefore'),
    },

    value: Number(val('dealValue')) || 0,
    currency: radioVal('dealCurrency') || 'USD',
    stage: val('dealStage') || 'new',
    workStatus: val('dealWorkStatus'),
    closeDate: val('dealClose'),
    services: val('dealServices') ? val('dealServices').split(',').map(s => s.trim()).filter(Boolean) : [],
    paymentBreakdown: paymentBreakdown,
    commLog: commLogEntries,
    notes: val('dealNotes'),
  };

  (deal.services || []).forEach(s => addOption('services', s));

  saveNewOptionsFromForm({
    fcRelation: 'relation',
    pmRelation: 'relation',
    refRelation: 'relation',
    requirement: 'requirement',
    fieldOfWork: 'fieldOfWork',
    nationality: 'nationality',
    currentLocation: 'currentLocation',
    reasonEnded: 'reasonEnded',
    specialInstructions: 'specialInstructions',
    fcName: 'personName',
    pmName: 'personName',
    refName: 'personName',
  });

  const wasEdit = Boolean(dealIdInput.value);
  saveDeal(deal);
  wizardSkipDirtyCheck = true;
  dealModal.hide();
  renderEverything();
  showToast(wasEdit ? 'Deal updated.' : 'Deal recorded.');
});

modalDeleteBtn.addEventListener('click', () => {
  const id = dealIdInput.value;
  if (id) confirmDelete(id);
});
