/* ============================================================
   entities.js
   ------------------------------------------------------------
   The Entities tab — unique companies/organizations, grouped live
   from deals.entityName. Same pattern as referrals.js/contacts.js.

   Exposes: renderEntities(), buildEntityGroups(), setEntitySearch(term)
   ============================================================ */

const entitySearchInput = document.getElementById('entitySearchInput');
const entitiesTableBody = document.getElementById('entitiesTableBody');
const entitiesEmptyState = document.getElementById('entitiesEmptyState');
const entitiesNoResultsState = document.getElementById('entitiesNoResultsState');
let entitySearchTerm = '';

function buildEntityGroups() {
  const deals = getDeals();
  const groups = new Map();

  deals.forEach(deal => {
    if (!deal.entityName) return;
    const key = deal.entityName.trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        name: deal.entityName, entityType: deal.entityType, fieldOfWork: deal.fieldOfWork,
        scale: deal.scale, nationality: deal.nationality, currentLocation: deal.currentLocation,
        deals: [], _latestUpdate: 0,
      });
    }
    const group = groups.get(key);
    if (deal.updatedAt >= group._latestUpdate) {
      group.entityType = deal.entityType;
      group.fieldOfWork = deal.fieldOfWork;
      group.scale = deal.scale;
      group.nationality = deal.nationality;
      group.currentLocation = deal.currentLocation;
      group._latestUpdate = deal.updatedAt;
    }
    group.deals.push(deal);
  });

  return Array.from(groups.values());
}

function renderEntityRow(group) {
  const totalValueUSD = group.deals.reduce((s, d) => s + toUSD(d.value, d.currency), 0);
  const typeBadge = group.entityType ? '<span class="entity-type entity-type--' + group.entityType + '">' + group.entityType + '</span>' : '<span class="no-referral">—</span>';

  return '' +
    '<tr>' +
      '<td><span class="deal-name">' + escapeHtml(group.name) + '</span></td>' +
      '<td>' + typeBadge + '</td>' +
      '<td>' + (group.fieldOfWork ? escapeHtml(group.fieldOfWork) : '<span class="no-referral">—</span>') + '</td>' +
      '<td>' + (group.currentLocation ? escapeHtml(group.currentLocation) : '<span class="no-referral">—</span>') + '</td>' +
      '<td class="text-end deal-value">' + formatDualCurrency(totalValueUSD, 'USD') + '</td>' +
      '<td>' +
        '<button type="button" class="referral-chip" data-jump="' + escapeHtml(group.name) + '">' +
          '<i class="bi bi-journal-text me-1"></i>' + group.deals.length + (group.deals.length === 1 ? ' deal' : ' deals') +
        '</button>' +
      '</td>' +
    '</tr>';
}

function renderEntities() {
  const allGroups = buildEntityGroups();

  if (allGroups.length === 0) {
    entitiesTableBody.innerHTML = '';
    entitiesEmptyState.classList.remove('d-none');
    entitiesNoResultsState.classList.add('d-none');
    return;
  }
  entitiesEmptyState.classList.add('d-none');

  let visible = allGroups;
  if (entitySearchTerm.trim()) {
    const term = entitySearchTerm.trim().toLowerCase();
    visible = allGroups.filter(g => g.name.toLowerCase().includes(term));
  }

  if (visible.length === 0) {
    entitiesTableBody.innerHTML = '';
    entitiesNoResultsState.classList.remove('d-none');
    return;
  }
  entitiesNoResultsState.classList.add('d-none');

  visible.sort((a, b) => b.deals.length - a.deals.length);
  entitiesTableBody.innerHTML = visible.map(renderEntityRow).join('');
}

entitiesTableBody.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-jump]');
  if (!chip) return;
  switchView('deals', { searchTerm: chip.dataset.jump });
});

let entitySearchDebounce;
entitySearchInput.addEventListener('input', (e) => {
  clearTimeout(entitySearchDebounce);
  entitySearchDebounce = setTimeout(() => { entitySearchTerm = e.target.value; renderEntities(); }, 150);
});

// Called by app.js's tab switcher.
function setEntitySearch(term) { entitySearchTerm = term; entitySearchInput.value = term; renderEntities(); }
