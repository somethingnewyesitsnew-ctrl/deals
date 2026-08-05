/* ============================================================
   globalsearch.js
   ------------------------------------------------------------
   The single search bar under the header. Searches all four
   groupings at once (deals, referrals, contacts, entities) and
   jumps to the right tab/record on click. Empty query shows
   the 5 most recently touched deals instead of nothing.

   Depends on: storage.js, deals.js (openDetailModal), directory.js
   (buildReferralGroups / buildContactGroups / buildEntityGroups),
   app.js (switchView).
   ============================================================ */

const globalSearchInput = document.getElementById('globalSearchInput');
const globalSearchResults = document.getElementById('globalSearchResults');
let lastGlobalResults = null;
let activeResultIndex = -1; // -1 = nothing highlighted yet

function computeGlobalResults(rawTerm) {
  const term = rawTerm.trim().toLowerCase();

  if (!term) {
    const recentDeals = getDeals()
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
      .map(d => ({
        label: d.entityName || 'Untitled entity',
        sub: 'Deal · ' + d.stage,
        action: () => { switchView('deals'); openDetailModal(d.id); },
      }));
    return { isRecent: true, deals: recentDeals, referrals: [], contacts: [], entities: [] };
  }

  const deals = getDeals()
    .filter(d => (d.entityName || '').toLowerCase().includes(term))
    .slice(0, 6)
    .map(d => ({
      label: d.entityName || 'Untitled entity',
      sub: 'Deal · ' + d.stage,
      action: () => { switchView('deals'); openDetailModal(d.id); },
    }));

  const referrals = buildReferralGroups()
    .filter(g => g.name.toLowerCase().includes(term))
    .slice(0, 6)
    .map(g => ({
      label: g.name,
      sub: 'Referral · ' + g.deals.length + (g.deals.length === 1 ? ' deal' : ' deals'),
      action: () => switchView('referrals', { searchTerm: g.name }),
    }));

  const contacts = buildContactGroups()
    .filter(g => g.name.toLowerCase().includes(term))
    .slice(0, 6)
    .map(g => ({
      label: g.name,
      sub: 'Contact · ' + Array.from(g.roles).join(', '),
      action: () => switchView('contacts', { searchTerm: g.name }),
    }));

  const entities = buildEntityGroups()
    .filter(g => g.name.toLowerCase().includes(term))
    .slice(0, 6)
    .map(g => ({
      label: g.name,
      sub: 'Entity · ' + g.deals.length + (g.deals.length === 1 ? ' deal' : ' deals'),
      action: () => switchView('entities', { searchTerm: g.name }),
    }));

  return { isRecent: false, deals, referrals, contacts, entities };
}

function renderGlobalResults() {
  const results = computeGlobalResults(globalSearchInput.value);
  lastGlobalResults = results;
  activeResultIndex = -1;

  const sections = [
    { key: 'deals', label: results.isRecent ? 'Recent deals' : 'Deals', items: results.deals },
    { key: 'referrals', label: 'Referrals', items: results.referrals },
    { key: 'contacts', label: 'Contacts', items: results.contacts },
    { key: 'entities', label: 'Entities', items: results.entities },
  ].filter(s => s.items.length);

  if (sections.length === 0) {
    globalSearchResults.innerHTML = '<div class="global-search__empty">No matches.</div>';
  } else {
    globalSearchResults.innerHTML = sections.map(s =>
      '<div class="global-search__section">' +
        '<div class="global-search__section-label">' + s.label + '</div>' +
        s.items.map((item, i) =>
          '<button type="button" class="global-search__item" data-section="' + s.key + '" data-index="' + i + '">' +
            '<span>' + escapeHtml(item.label) + '</span>' +
            '<span class="global-search__sub">' + escapeHtml(item.sub) + '</span>' +
          '</button>'
        ).join('') +
      '</div>'
    ).join('');
  }

  globalSearchResults.classList.remove('d-none');
}

globalSearchInput.addEventListener('focus', renderGlobalResults);

let globalSearchDebounce;
globalSearchInput.addEventListener('input', () => {
  clearTimeout(globalSearchDebounce);
  globalSearchDebounce = setTimeout(renderGlobalResults, 120);
});

function getResultButtons() {
  return Array.from(globalSearchResults.querySelectorAll('.global-search__item'));
}

function setActiveResultIndex(index) {
  const buttons = getResultButtons();
  if (!buttons.length) { activeResultIndex = -1; return; }
  activeResultIndex = (index + buttons.length) % buttons.length;
  buttons.forEach((btn, i) => btn.classList.toggle('is-active', i === activeResultIndex));
  buttons[activeResultIndex].scrollIntoView({ block: 'nearest' });
}

function activateResultButton(btn) {
  if (!btn || !lastGlobalResults) return;
  const item = lastGlobalResults[btn.dataset.section][Number(btn.dataset.index)];
  if (item) item.action();
  globalSearchResults.classList.add('d-none');
  globalSearchInput.value = '';
}

globalSearchResults.addEventListener('click', (e) => {
  const btn = e.target.closest('.global-search__item');
  if (btn) activateResultButton(btn);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#globalSearchWrap')) globalSearchResults.classList.add('d-none');
});

globalSearchInput.addEventListener('keydown', (e) => {
  const isOpen = !globalSearchResults.classList.contains('d-none');

  if (e.key === 'Escape') {
    globalSearchResults.classList.add('d-none');
    return;
  }
  if (!isOpen) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActiveResultIndex(activeResultIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActiveResultIndex(activeResultIndex - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const buttons = getResultButtons();
    const target = activeResultIndex >= 0 ? buttons[activeResultIndex] : buttons[0];
    activateResultButton(target);
  }
});
