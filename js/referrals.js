/* ============================================================
   referrals.js
   ------------------------------------------------------------
   The Referrals tab. Not stored separately — grouped live from
   every deal's referral field (see README "Data model"). Same
   pattern repeats in contacts.js and entities.js; kept as three
   files instead of one so touching one tab never means opening
   the other two.

   Exposes: renderReferrals(), buildReferralGroups(), setReferralSearch(term)
   ============================================================ */

const referralSearchInput = document.getElementById('referralSearchInput');
const referralsTableBody = document.getElementById('referralsTableBody');
const referralsEmptyState = document.getElementById('referralsEmptyState');
const referralsNoResultsState = document.getElementById('referralsNoResultsState');
let referralSearchTerm = '';

function yesNoLabel(v) {
  if (v === 'yes') return '<span class="stage-badge stage-badge--won">Yes</span>';
  if (v === 'no') return '<span class="stage-badge stage-badge--lost">No</span>';
  return '<span class="no-referral">—</span>';
}

function buildReferralGroups() {
  const deals = getDeals();
  const groups = new Map();

  deals.forEach(deal => {
    const ref = deal.referral;
    if (!ref || !ref.name) return;
    const key = ref.name.trim().toLowerCase();

    if (!groups.has(key)) groups.set(key, Object.assign({}, ref, { deals: [], _latestUpdate: 0 }));
    const group = groups.get(key);
    if (deal.updatedAt >= group._latestUpdate) {
      Object.assign(group, ref);
      group._latestUpdate = deal.updatedAt;
    }
    group.deals.push(deal);
  });

  return Array.from(groups.values());
}

function renderReferralRow(group) {
  const contactBits = [];
  if (group.number) contactBits.push(escapeHtml(group.number));
  if (group.email) contactBits.push(escapeHtml(group.email));
  const contact = contactBits.length ? contactBits.join('<br>') : '<span class="no-referral">—</span>';
  const totalValueUSD = group.deals.reduce((s, d) => s + toUSD(d.value, d.currency), 0);

  return '' +
    '<tr>' +
      '<td><span class="deal-name">' + escapeHtml(group.name) + '</span></td>' +
      '<td>' + contact + '</td>' +
      '<td>' + (group.relation ? escapeHtml(group.relation) : '<span class="no-referral">—</span>') + '</td>' +
      '<td>' + yesNoLabel(group.firstTime) + '</td>' +
      '<td>' + yesNoLabel(group.paidBefore) + '</td>' +
      '<td class="text-end deal-value">' + formatDualCurrency(totalValueUSD, 'USD') + '</td>' +
      '<td>' +
        '<button type="button" class="referral-chip" data-jump="' + escapeHtml(group.name) + '">' +
          '<i class="bi bi-journal-text me-1"></i>' + group.deals.length + (group.deals.length === 1 ? ' deal' : ' deals') +
        '</button>' +
      '</td>' +
    '</tr>';
}

function renderReferrals() {
  const allGroups = buildReferralGroups();

  if (allGroups.length === 0) {
    referralsTableBody.innerHTML = '';
    referralsEmptyState.classList.remove('d-none');
    referralsNoResultsState.classList.add('d-none');
    return;
  }
  referralsEmptyState.classList.add('d-none');

  let visible = allGroups;
  if (referralSearchTerm.trim()) {
    const term = referralSearchTerm.trim().toLowerCase();
    visible = allGroups.filter(g => g.name.toLowerCase().includes(term));
  }

  if (visible.length === 0) {
    referralsTableBody.innerHTML = '';
    referralsNoResultsState.classList.remove('d-none');
    return;
  }
  referralsNoResultsState.classList.add('d-none');

  visible.sort((a, b) => b.deals.length - a.deals.length);
  referralsTableBody.innerHTML = visible.map(renderReferralRow).join('');
}

referralsTableBody.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-jump]');
  if (!chip) return;
  switchView('deals', { searchTerm: chip.dataset.jump });
});

let referralSearchDebounce;
referralSearchInput.addEventListener('input', (e) => {
  clearTimeout(referralSearchDebounce);
  referralSearchDebounce = setTimeout(() => { referralSearchTerm = e.target.value; renderReferrals(); }, 150);
});

// Called by app.js's tab switcher.
function setReferralSearch(term) { referralSearchTerm = term; referralSearchInput.value = term; renderReferrals(); }
