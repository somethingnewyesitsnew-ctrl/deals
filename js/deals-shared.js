/* ============================================================
   deals-shared.js
   ------------------------------------------------------------
   Small, cross-cutting pieces that deals-table.js, deals-wizard.js,
   and deals-detail.js all need. Kept separate specifically so those
   three files stay focused on ONE screen each — if you're editing
   the wizard, you shouldn't need to open the table file too.

   Exposes: formatIndex, RELATIONSHIP_LABELS, relationshipDot,
            isOverdue, confirmDelete
   ============================================================ */

function formatIndex(n) { return 'No. ' + String(n).padStart(3, '0'); }

const RELATIONSHIP_LABELS = { excellent: 'Excellent', good: 'Good', neutral: 'Neutral', issues: 'Had issues', bad: 'Bad' };

function relationshipDot(status) {
  if (!status || !RELATIONSHIP_LABELS[status]) return '';
  return '<span class="relationship-dot relationship-dot--' + status + '" title="Relationship: ' + RELATIONSHIP_LABELS[status] + '"></span>';
}

// ---------- Development / work status ----------
const WORK_STATUS_LABELS = {
  not_started: 'Not started', in_progress: 'In progress', on_hold: 'On hold',
  completed: 'Completed', delivered: 'Delivered',
};
const WORK_STATUS_TONE = {
  not_started: 'slate', in_progress: 'cyan', on_hold: 'amber',
  completed: 'green', delivered: 'accent',
};

function workStatusBadge(status) {
  if (!status || !WORK_STATUS_LABELS[status]) return '<span class="no-referral">—</span>';
  return '<span class="dev-status-badge dev-status-badge--' + WORK_STATUS_TONE[status] + '">' + WORK_STATUS_LABELS[status] + '</span>';
}

// ---------- Payment status (paid / partial / unpaid), shared by table + detail + totals ----------
function dealPaymentStatus(deal) {
  const invoices = deal.invoices || [];
  const dealValueUSD = toUSD(deal.value, deal.currency);

  if (invoices.length === 0) {
    return { label: 'No invoice', tone: 'slate', paidUSD: 0, remainingUSD: dealValueUSD };
  }

  const paidUSD = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((s, inv) => s + toUSD(invoiceTotal(inv.items), inv.currency), 0);

  const remainingUSD = Math.max(0, dealValueUSD - paidUSD);

  if (remainingUSD <= 0.01) return { label: 'Paid', tone: 'green', paidUSD, remainingUSD: 0 };
  if (paidUSD > 0) return { label: 'Partial', tone: 'amber', paidUSD, remainingUSD };
  return { label: 'Unpaid', tone: 'danger', paidUSD, remainingUSD };
}

function isOverdue(deal) {
  if (!deal.closeDate) return false;
  if (deal.stage === 'won' || deal.stage === 'lost') return false;
  return new Date(deal.closeDate) < new Date(new Date().toDateString());
}

// One consolidated check — overdue close date, closing/invoice-due soon,
// stalled (no activity in 14+ days), or never-contacted — powers the small
// notification badge on each table row. Mirrors attention.js's buckets
// without needing to load-order-depend on that file.
function dealNeedsAttention(deal) {
  const dayMs = 24 * 60 * 60 * 1000;
  const soonCutoff = Date.now() + 7 * dayMs;

  const hasDueInvoice = (deal.invoices || []).some(inv =>
    inv.status !== 'paid' && inv.dueDate && new Date(inv.dueDate).getTime() <= soonCutoff
  );
  if (hasDueInvoice) return true;

  // A logged follow-up date (from the wizard's comm log or a Quick Update)
  // that's overdue or coming up soon — regardless of the deal's stage,
  // since a "won" deal can still have an outstanding follow-up.
  const hasDueFollowUp = (deal.commLog || []).some(entry => {
    const state = followUpState(entry);
    return state === 'overdue' || state === 'soon';
  });
  if (hasDueFollowUp) return true;

  if (deal.stage === 'won' || deal.stage === 'lost') return false;

  if (isOverdue(deal)) return true;
  if (deal.closeDate) {
    const t = new Date(deal.closeDate).getTime();
    if (t >= Date.now() && t <= soonCutoff) return true;
  }
  if (deal.stage === 'new' && (!deal.commLog || deal.commLog.length === 0)) return true;

  const last = lastActivityTimestamp(deal);
  if (!last || (Date.now() - last) >= 14 * dayMs) return true;

  return false;
}

// ---------- Delete confirmation (shared by table row, wizard, detail view) ----------
const deleteModalEl = document.getElementById('deleteModal');
const deleteModal = new bootstrap.Modal(deleteModalEl);
const deleteDealNameEl = document.getElementById('deleteDealName');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
let pendingDeleteId = null;

function confirmDelete(dealId) {
  const deal = getDeals().find(d => d.id === dealId);
  pendingDeleteId = dealId;
  deleteDealNameEl.textContent = deal ? (deal.entityName || 'this deal') : 'this deal';
  deleteModal.show();
}

confirmDeleteBtn.addEventListener('click', () => {
  if (!pendingDeleteId) return;
  deleteDeal(pendingDeleteId);
  pendingDeleteId = null;
  deleteModal.hide();
  dealModal.hide();
  detailModal.hide();
  renderEverything();
  showToast('Deal deleted.');
});
