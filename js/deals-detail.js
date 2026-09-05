/* ============================================================
   deals-detail.js
   ------------------------------------------------------------
   The read-only detail popup opened by clicking a deal row (or
   from Referrals/Contacts/Entities/Attention/Calendar links that
   land on a specific deal). Entirely separate from the edit
   wizard — "Edit" here just closes this and opens deals-wizard.js's
   openWizard() prefilled.

   Exposes: openDetailModal(dealId)
   ============================================================ */

// ---------- DOM refs ----------
const detailModalEl = document.getElementById('detailModal');
const detailModal = new bootstrap.Modal(detailModalEl);
const detailBody = document.getElementById('detailBody');
const detailTitle = document.getElementById('detailTitle');
const detailIndexLabel = document.getElementById('detailIndexLabel');
const detailEditBtn = document.getElementById('detailEditBtn');
const detailDeleteBtn = document.getElementById('detailDeleteBtn');

let currentDetailDealId = null;

// ---------- Small render helpers ----------
function fieldRow(label, value) {
  return '<div class="detail-field"><span class="detail-field__label">' + label + '</span>' +
    '<span class="detail-field__value">' + (value ? escapeHtml(value) : '<span class="no-referral">—</span>') + '</span></div>';
}

// Contact card — ported from the mockup's "Primary Contact" pattern:
// a circular avatar with initials, name + role/relation, then
// email/phone as icon rows underneath.
function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function personCard(title, person) {
  person = person || {};
  if (!person.name && !person.number && !person.email && !person.relation) {
    return '<div class="detail-card"><h4>' + title + '</h4><p class="no-referral">Not recorded.</p></div>';
  }
  const rows = [];
  if (person.email) rows.push('<div class="person-card__row"><i class="bi bi-envelope"></i>' + escapeHtml(person.email) + '</div>');
  if (person.number) rows.push('<div class="person-card__row"><i class="bi bi-telephone"></i>' + escapeHtml(person.number) + '</div>');

  return '<div class="detail-card"><h4>' + title + '</h4>' +
    '<div class="person-card__head">' +
      '<span class="person-card__avatar">' + escapeHtml(initialsOf(person.name)) + '</span>' +
      '<div>' +
        '<div class="person-card__name">' + escapeHtml(person.name || 'Unnamed') + '</div>' +
        (person.relation ? '<div class="person-card__role">' + escapeHtml(person.relation) + '</div>' : '') +
      '</div>' +
    '</div>' +
    (rows.length ? '<div class="person-card__rows">' + rows.join('') + '</div>' : '') +
  '</div>';
}

// ---------- Main render ----------
function closeDateStatus(deal) {
  if (!deal.closeDate) return { text: 'No close date set', tone: 'slate' };
  if (isOverdue(deal)) {
    const days = Math.max(0, Math.round((new Date(new Date().toDateString()) - new Date(deal.closeDate)) / (1000 * 60 * 60 * 24)));
    return { text: days + 'd overdue', tone: 'danger' };
  }
  if (deal.stage === 'won' || deal.stage === 'lost') return { text: relativeDayLabel(deal.closeDate), tone: 'slate' };
  return { text: 'Closes ' + relativeDayLabel(deal.closeDate), tone: 'amber' };
}

// A row of small at-a-glance boxes — stage, relationship, timeline status,
// last activity, referral, invoices — so the essentials of a deal read in
// one scan instead of hunting through the cards below.
const RELATIONSHIP_TONE = { excellent: 'green', good: 'cyan', neutral: 'slate', issues: 'amber', bad: 'danger' };

// Value Summary box — ported from the mockup: two figures side by side
// in one bordered strip. Real deals don't track a numeric "win
// probability" (stage is qualitative, not scored), so the right side
// shows payment status instead — a real, non-fabricated number that
// answers the same "how's this actually doing" question.
function valueSummaryBox(deal) {
  const payment = dealPaymentStatus(deal);
  return '' +
    '<div class="value-summary-box">' +
      '<div>' +
        '<p class="value-summary-box__label">Deal Value</p>' +
        '<div class="value-summary-box__figure">' + formatUSD(toUSD(deal.value, deal.currency)) + '</div>' +
      '</div>' +
      '<div class="value-summary-box__side">' +
        '<p class="value-summary-box__label">Payment</p>' +
        '<div class="value-summary-box__status value-summary-box__status--' + payment.tone + '">' + payment.label + '</div>' +
      '</div>' +
    '</div>';
}

function renderStatusBoxes(deal) {
  const timeline = closeDateStatus(deal);
  const payment = dealPaymentStatus(deal);

  const boxes = [
    { label: 'Stage', value: deal.stage.charAt(0).toUpperCase() + deal.stage.slice(1), tone: 'accent' },
    { label: 'Development', value: WORK_STATUS_LABELS[deal.workStatus] || 'Not set', tone: WORK_STATUS_TONE[deal.workStatus] || 'slate' },
    { label: 'Payment', value: payment.label + (payment.remainingUSD > 0.01 ? ' · ' + formatUSD(payment.remainingUSD) + ' left' : ''), tone: payment.tone },
    { label: 'Relationship', value: RELATIONSHIP_LABELS[deal.relationshipStatus] || 'Not set', tone: RELATIONSHIP_TONE[deal.relationshipStatus] || 'slate' },
    { label: 'Timeline', value: timeline.text, tone: timeline.tone },
    { label: 'Last activity', value: timeAgo(lastActivityTimestamp(deal)) || 'No activity yet', tone: 'slate' },
    { label: 'Referral', value: (deal.referral && deal.referral.name) ? deal.referral.name : 'None', tone: (deal.referral && deal.referral.name) ? 'accent' : 'slate' },
  ];

  return '<div class="status-box-grid">' + boxes.map(b =>
    '<div class="status-box status-box--' + b.tone + '"><span class="status-box__label">' + b.label + '</span><span class="status-box__value">' + escapeHtml(String(b.value)) + '</span></div>'
  ).join('') + '</div>';
}

function openDetailModal(dealId) {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;
  currentDetailDealId = dealId;

  detailTitle.textContent = deal.entityName || 'Untitled entity';
  detailIndexLabel.textContent = formatIndex(deal.entryIndex);

  const typeBadge = deal.entityType ? '<span class="entity-type entity-type--' + deal.entityType + '">' + deal.entityType + '</span>' : '';
  const relDot = relationshipDot(deal.relationshipStatus);
  const closeLabel = deal.closeDate
    ? new Date(deal.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const referralBlock = (deal.referral && deal.referral.name)
    ? '<div class="detail-card"><h4><i class="bi bi-arrow-up-right-circle"></i> Referral</h4>' +
        fieldRow('Name', deal.referral.name) +
        fieldRow('Number', deal.referral.number) +
        fieldRow('Email', deal.referral.email) +
        fieldRow('Relation with us', deal.referral.relation) +
        fieldRow('First time referring us', deal.referral.firstTime === 'yes' ? 'Yes' : deal.referral.firstTime === 'no' ? 'No' : '') +
        fieldRow('Paid by us before', deal.referral.paidBefore === 'yes' ? 'Yes' : deal.referral.paidBefore === 'no' ? 'No' : '') +
        '<button type="button" class="link-btn mt-2" id="detailJumpReferral">View on Referrals page →</button>' +
      '</div>'
    : '';

  // Timeline — ported from the mockup's connected vertical activity feed:
  // a left border line with a dot per entry (the most recent one solid
  // and larger, matching the mockup's filled-vs-hollow distinction),
  // rather than the previous stacked-card list.
  const updatesHtml = (deal.commLog && deal.commLog.length)
    ? '<ul class="update-timeline">' + deal.commLog
        .slice()
        .sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''))
        .map((entry, i) => {
          const dayLabel = relativeDayLabel(entryDateKey(entry));
          const time = (entry.datetime && entry.datetime.includes('T'))
            ? new Date(entry.datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : '';
          const metaBits = [entry.channel, entry.action, entry.nextStep ? (entry.nextStep + (entry.nextStepDate ? ' (' + relativeDayLabel(entry.nextStepDate) + ')' : '')) : null].filter(Boolean).map(escapeHtml);
          const title = entry.note || entry.action || entry.channel || 'Update';

          return '<li class="update-timeline__item" data-id="' + entry.id + '">' +
            '<span class="update-timeline__dot' + (i === 0 ? ' update-timeline__dot--latest' : '') + '"></span>' +
            '<div class="update-timeline__body">' +
              '<div class="update-timeline__head">' +
                '<p class="update-timeline__title">' + escapeHtml(title) + '</p>' +
                statusBadge(entry.status) +
                '<button type="button" class="update-item__remove" data-remove-update="' + entry.id + '" aria-label="Remove update"><i class="bi bi-trash3"></i></button>' +
              '</div>' +
              (metaBits.length ? '<div class="update-item__meta">' + metaBits.join(' <span class="meta-dot">·</span> ') + '</div>' : '') +
              '<p class="update-timeline__when">' + escapeHtml(dayLabel) + (time ? ', ' + time : '') + '</p>' +
            '</div>' +
          '</li>';
        }).join('') + '</ul>'
    : '<p class="no-referral">No updates logged yet.</p>';

  const lastActive = timeAgo(lastActivityTimestamp(deal));

  detailBody.innerHTML =
    '<div class="detail-top">' +
      '<div class="detail-top__left">' +
        '<div class="detail-top__badges">' + relDot + typeBadge + '<span class="stage-badge stage-badge--' + deal.stage + '">' + deal.stage + '</span></div>' +
        (lastActive ? '<span class="detail-last-activity"><i class="bi bi-clock-history"></i>' + lastActive + '</span>' : '') +
      '</div>' +
      '<div class="detail-value">' + formatDualCurrency(deal.value, deal.currency) + '</div>' +
    '</div>' +

    valueSummaryBox(deal) +
    renderStatusBoxes(deal) +

    '<div class="detail-card">' +
      '<div class="detail-card__head-row">' +
        '<h4><i class="bi bi-clock-history"></i> Updates</h4>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" id="detailAddUpdateBtn"><i class="bi bi-plus-lg"></i> Add update</button>' +
      '</div>' +
      updatesHtml +
    '</div>' +

    '<div class="detail-grid">' +
      '<div class="detail-card">' +
        '<h4><i class="bi bi-building"></i> Entity</h4>' +
        fieldRow('Requirement', deal.requirement) +
        fieldRow('Field of work', deal.fieldOfWork) +
        fieldRow('Scale', deal.scale) +
        fieldRow('First time working with us', deal.firstTime === 'yes' ? 'Yes' : deal.firstTime === 'no' ? 'No' : '') +
        fieldRow('Nationality', deal.nationality) +
        fieldRow('Current location', deal.currentLocation) +
        fieldRow('Expected close', closeLabel) +
      '</div>' +

      '<div class="detail-card">' +
        '<h4><i class="bi bi-heart"></i> Relationship with us</h4>' +
        fieldRow('Status', RELATIONSHIP_LABELS[deal.relationshipStatus] || '') +
        fieldRow('Would work with them again', deal.wouldWorkAgain === 'yes' ? 'Yes' : deal.wouldWorkAgain === 'no' ? 'No' : '') +
        fieldRow('Reason relationship ended', deal.reasonEnded) +
        fieldRow('Special instructions', deal.specialInstructions) +
        (deal.relationshipNotes ? '<p class="detail-notes mt-2">' + escapeHtml(deal.relationshipNotes) + '</p>' : '') +
      '</div>' +
    '</div>' +

    ((deal.services && deal.services.length)
      ? '<div class="detail-card"><h4><i class="bi bi-bag-check"></i> Products / Services</h4><div class="comm-chips">' +
          deal.services.map(s => '<span class="comm-chip comm-chip--channel">' + escapeHtml(s) + '</span>').join('') +
        '</div></div>'
      : '') +

    renderInvoiceSection(deal) +

    renderDealProjectSection(deal) +

    renderDocumentsSection(deal) +

    '<div class="detail-grid">' +
      personCard('First contact person', deal.firstContact) +
      personCard('Project manager (their side)', deal.projectManager) +
    '</div>' +

    referralBlock +

    (deal.notes ? '<div class="detail-card"><h4><i class="bi bi-sticky"></i> Notes</h4><p class="detail-notes">' + escapeHtml(deal.notes) + '</p></div>' : '');

  const jumpBtn = document.getElementById('detailJumpReferral');
  if (jumpBtn) {
    jumpBtn.addEventListener('click', () => {
      detailModal.hide();
      switchView('referrals', { searchTerm: deal.referral.name });
    });
  }

  document.getElementById('detailAddUpdateBtn').addEventListener('click', () => {
    openQuickUpdateModal(deal.id);
  });

  detailModal.show();
}

detailEditBtn.addEventListener('click', () => {
  detailModal.hide();
  openWizard(currentDetailDealId);
});

detailDeleteBtn.addEventListener('click', () => {
  if (currentDetailDealId) confirmDelete(currentDetailDealId);
});

// ---------- Project section (deal → project conversion + linked projects) ----------
function renderDealProjectSection(deal) {
  const linkedProjects = typeof getProjects === 'function' ? getProjects().filter(p => p.dealId === deal.id) : [];

  if (linkedProjects.length === 0) {
    return '' +
      '<div class="detail-card">' +
        '<div class="detail-card__head-row">' +
          '<h4><i class="bi bi-kanban"></i> Project</h4>' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" id="detailConvertToProjectBtn" data-deal="' + deal.id + '"><i class="bi bi-arrow-right-circle"></i> Convert to project</button>' +
        '</div>' +
        '<p class="no-referral">No project started yet — convert this deal once work begins.</p>' +
      '</div>';
  }

  return '' +
    '<div class="detail-card">' +
      '<h4><i class="bi bi-kanban"></i> Project</h4>' +
      linkedProjects.map(p => {
        const progress = projectPhaseProgress(p);
        return '<button type="button" class="attention-row" data-open-deal-project="' + p.id + '">' +
          '<span class="attention-row__name">' + escapeHtml(p.name) + '</span>' +
          '<span class="dev-status-badge dev-status-badge--' + WORK_STATUS_TONE[p.status] + '">' + WORK_STATUS_LABELS[p.status] + '</span>' +
          (progress.total ? '<span class="attention-row__note">' + progress.done + '/' + progress.total + ' phases</span>' : '') +
          '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
        '</button>';
      }).join('') +
    '</div>';
}

// Shared entry point — the deal detail drawer's 'Convert to project' button
// and the Deals table row menu's 'Convert to project' item both call this,
// so there's exactly one place that knows how to prefill a new project
// from a deal.
function convertDealToProject(dealId) {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;
  if (detailModalEl.classList.contains('show')) detailModal.hide();
  openProjectModal(); // blank editor, prefilled below
  document.getElementById('projectName').value = deal.entityName || '';
  document.getElementById('projectDescription').value = deal.requirement ? ('Requirement: ' + deal.requirement) : '';
  // Prefill via a hidden convert-source so the save handler attaches dealId.
  projectConvertSourceDealId = deal.id;
  document.getElementById('projectClientNameRow').classList.add('d-none');
  document.getElementById('projectDealBadgeRow').classList.remove('d-none');
  document.getElementById('projectDealBadgeRow').innerHTML = '<span class="link-chip"><i class="bi bi-journal-text"></i>' + escapeHtml(deal.entityName || 'Untitled entity') + '</span> <span class="dropdown-hint d-inline">will be linked once saved</span>';
  showToast('Fill in the project type and phases, then save.');
}

document.getElementById('detailBody').addEventListener('click', (e) => {
  const convertBtn = e.target.closest('#detailConvertToProjectBtn');
  if (convertBtn) { convertDealToProject(convertBtn.dataset.deal); return; }
  const openProjectBtn = e.target.closest('[data-open-deal-project]');
  if (openProjectBtn) {
    detailModal.hide();
    switchView('projects');
    openProjectModal(openProjectBtn.dataset.openDealProject);
  }
});

// Delegated on detailBody (a stable container that never gets swapped out
// itself, just its innerHTML) rather than re-attached per render, same
// pattern invoices.js/documents.js use for their own detailBody buttons.
document.getElementById('detailBody').addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-remove-update]');
  if (!removeBtn) return;
  const dealId = currentDetailDealId;
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;
  if (!confirm('Delete this update? This can\'t be undone.')) return;

  const commLog = (deal.commLog || []).filter(entry => entry.id !== removeBtn.dataset.removeUpdate);
  saveDeal({ id: dealId, commLog });
  renderEverything();
  openDetailModal(dealId);
  showToast('Update deleted.');
});
