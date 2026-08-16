/* ============================================================
   contacts.js
   ------------------------------------------------------------
   The Contacts tab — every deal's firstContact and projectManager,
   deduped by name+number. Grouped live from deals, same as
   referrals.js and entities.js.

   Exposes: renderContacts(), buildContactGroups(), setContactSearch(term)
   ============================================================ */

const contactSearchInput = document.getElementById('contactSearchInput');
const contactsTableBody = document.getElementById('contactsTableBody');
const contactsEmptyState = document.getElementById('contactsEmptyState');
const contactsNoResultsState = document.getElementById('contactsNoResultsState');
let contactSearchTerm = '';

function buildContactGroups() {
  const deals = getDeals();
  const groups = new Map();

  function addPerson(person, role, deal) {
    if (!person || !person.name) return;
    const key = person.name.trim().toLowerCase() + '|' + (person.number || '').trim();
    if (!groups.has(key)) groups.set(key, Object.assign({}, person, { roles: new Set(), deals: [], _latestUpdate: 0 }));
    const group = groups.get(key);
    group.roles.add(role);
    if (deal.updatedAt >= group._latestUpdate) {
      Object.assign(group, person);
      group._latestUpdate = deal.updatedAt;
    }
    group.deals.push(deal);
  }

  deals.forEach(deal => {
    addPerson(deal.firstContact, 'First contact', deal);
    addPerson(deal.projectManager, 'Project manager', deal);
  });

  // Grouping is by name + number — two genuinely different people who
  // happen to share a first name AND have no phone number on file for
  // either of them collide into one group with no way to tell them apart
  // after the fact. Flag that case (blank number, more than one deal
  // feeding into the group) so it's visible instead of silent.
  groups.forEach(group => {
    group._possibleMerge = !((group.number || '').trim()) && group.deals.length > 1;
  });

  return Array.from(groups.values());
}

function renderContactRow(group) {
  const contactBits = [];
  if (group.number) contactBits.push(escapeHtml(group.number));
  if (group.email) contactBits.push(escapeHtml(group.email));
  const contact = contactBits.length ? contactBits.join('<br>') : '<span class="no-referral">—</span>';
  const roles = Array.from(group.roles).map(r =>
    '<span class="entity-type entity-type--' + (r === 'First contact' ? 'government' : 'international') + '">' + r + '</span>'
  ).join(' ');

  const contactKey = contactKeyOf(group.name, group.number);
  const updateCount = getContactUpdates(contactKey).length;
  const hasDueFollowUp = getContactUpdates(contactKey).some(entry => {
    const state = followUpState(entry);
    return state === 'overdue' || state === 'soon';
  });

  const dupWarning = group._possibleMerge
    ? '<i class="bi bi-exclamation-triangle-fill ms-1" style="color:var(--amber)" title="No phone number on file — this row may be merging multiple different people who happen to share this name. Add a number on any linked deal to tell them apart."></i>'
    : '';

  return '' +
    '<tr>' +
      '<td><span class="deal-name">' + escapeHtml(group.name) + '</span>' + dupWarning + '</td>' +
      '<td><div class="deal-badges">' + roles + '</div></td>' +
      '<td>' + contact + '</td>' +
      '<td>' + (group.relation ? escapeHtml(group.relation) : '<span class="no-referral">—</span>') + '</td>' +
      '<td>' +
        '<button type="button" class="referral-chip" data-contact-update="' + escapeHtml(contactKey) + '" data-contact-name="' + escapeHtml(group.name) + '">' +
          (hasDueFollowUp ? '<i class="bi bi-bell-fill me-1" style="color:var(--red)"></i>' : '<i class="bi bi-clock-history me-1"></i>') +
          updateCount + (updateCount === 1 ? ' update' : ' updates') +
        '</button>' +
      '</td>' +
      '<td>' +
        '<div class="deal-badges">' +
        '<button type="button" class="referral-chip" data-related-deals="' + escapeHtml(group.name) + '">' +
          '<i class="bi bi-journal-text me-1"></i>' + group.deals.length + (group.deals.length === 1 ? ' deal' : ' deals') +
        '</button>' +
        linkedItemsBadgeHtml('contact', contactKey) +
        '</div>' +
      '</td>' +
    '</tr>';
}

function renderContacts() {
  const allGroups = buildContactGroups();

  if (allGroups.length === 0) {
    contactsTableBody.innerHTML = '';
    contactsEmptyState.classList.remove('d-none');
    contactsNoResultsState.classList.add('d-none');
    return;
  }
  contactsEmptyState.classList.add('d-none');

  let visible = allGroups;
  if (contactSearchTerm.trim()) {
    const term = contactSearchTerm.trim().toLowerCase();
    visible = allGroups.filter(g => g.name.toLowerCase().includes(term));
  }

  if (visible.length === 0) {
    contactsTableBody.innerHTML = '';
    contactsNoResultsState.classList.remove('d-none');
    return;
  }
  contactsNoResultsState.classList.add('d-none');

  visible.sort((a, b) => b.deals.length - a.deals.length);
  contactsTableBody.innerHTML = visible.map(renderContactRow).join('');
}

contactsTableBody.addEventListener('click', (e) => {
  const updateBtn = e.target.closest('[data-contact-update]');
  if (updateBtn) {
    openContactUpdateModal(updateBtn.dataset.contactUpdate, updateBtn.dataset.contactName);
    return;
  }
  const chip = e.target.closest('[data-related-deals]');
  if (!chip) return;
  const name = chip.dataset.relatedDeals;
  const group = buildContactGroups().find(g => g.name === name);
  openRelatedDealsModal(name + ' — deals', group ? group.deals : []);
});

let contactSearchDebounce;
contactSearchInput.addEventListener('input', (e) => {
  clearTimeout(contactSearchDebounce);
  contactSearchDebounce = setTimeout(() => { contactSearchTerm = e.target.value; renderContacts(); }, 150);
});

// Called by app.js's tab switcher.
function setContactSearch(term) { contactSearchTerm = term; contactSearchInput.value = term; renderContacts(); }
