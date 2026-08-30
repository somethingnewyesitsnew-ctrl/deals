/* ============================================================
   links.js
   ------------------------------------------------------------
   The universal "link to anything" system shared by To-Dos,
   Financial entries (income/expenses), and Debts. One reusable
   picker component instead of three copies of the same logic.

   A link is: { type, id, label, dealId? }
   type is one of: 'deal' | 'contact' | 'referral' | 'entity' |
                   'invoice' | 'custom'

   Exposes:
     - LINK_TYPE_META
     - searchLinkableItems(term)
     - openLinkDetails(link)   — click a chip, see its details
     - createLinkPicker({ container, chipsEl })
   ============================================================ */

const LINK_TYPE_META = {
  deal: { icon: 'bi-journal-text', label: 'Deal' },
  project: { icon: 'bi-kanban', label: 'Project' },
  contact: { icon: 'bi-person', label: 'Contact' },
  referral: { icon: 'bi-arrow-up-right-circle', label: 'Referral' },
  entity: { icon: 'bi-building', label: 'Entity' },
  invoice: { icon: 'bi-receipt', label: 'Invoice' },
  custom: { icon: 'bi-tag', label: 'Tag / project' },
};

function searchLinkableItems(term) {
  term = term.trim().toLowerCase();
  if (!term) return [];
  const results = [];

  getDeals().forEach(d => {
    if ((d.entityName || '').toLowerCase().includes(term)) {
      results.push({ type: 'deal', id: d.id, label: d.entityName || 'Untitled entity' });
    }
  });

  if (typeof getProjects === 'function') {
    getProjects().forEach(p => {
      if ((p.name || '').toLowerCase().includes(term)) {
        results.push({ type: 'project', id: p.id, label: p.name });
      }
    });
  }

  if (typeof buildContactGroups === 'function') {
    buildContactGroups().forEach(g => {
      if (g.name.toLowerCase().includes(term)) {
        results.push({ type: 'contact', id: contactKeyOf(g.name, g.number), label: g.name });
      }
    });
  }

  if (typeof buildReferralGroups === 'function') {
    buildReferralGroups().forEach(g => {
      if (g.name.toLowerCase().includes(term)) {
        results.push({ type: 'referral', id: g.name.toLowerCase(), label: g.name });
      }
    });
  }

  if (typeof buildEntityGroups === 'function') {
    buildEntityGroups().forEach(g => {
      if (g.name.toLowerCase().includes(term)) {
        results.push({ type: 'entity', id: g.name.toLowerCase(), label: g.name });
      }
    });
  }

  if (typeof getAllInvoicesFlat === 'function') {
    getAllInvoicesFlat().forEach(({ deal, invoice }) => {
      const hay = (invoice.number + ' ' + (deal.entityName || '')).toLowerCase();
      if (hay.includes(term)) {
        results.push({ type: 'invoice', id: invoice.id, dealId: deal.id, label: invoice.number + ' · ' + (deal.entityName || 'Untitled entity') });
      }
    });
  }

  return results.slice(0, 10);
}

// Click a link chip → jump straight to that thing's own detail view,
// with all of its own links/updates, instead of just showing a label.
function openLinkDetails(link) {
  if (!link) return;
  switch (link.type) {
    case 'deal':
      switchView('deals');
      if (typeof openDetailModal === 'function') openDetailModal(link.id);
      return;
    case 'project':
      switchView('projects');
      if (typeof openProjectModal === 'function') openProjectModal(link.id);
      return;
    case 'contact':
      switchView('contacts');
      if (typeof openContactUpdateModal === 'function') openContactUpdateModal(link.id, link.label);
      return;
    case 'referral':
      switchView('referrals', { searchTerm: link.label });
      return;
    case 'entity':
      switchView('entities', { searchTerm: link.label });
      return;
    case 'invoice':
      if (typeof openInvoicePrintView === 'function') openInvoicePrintView(link.dealId, link.id);
      return;
    default:
      if (typeof showToast === 'function') showToast('"' + link.label + '" is a free-typed tag — nothing to open.');
  }
}

// The types offered as their own inline dropdown, in display order.
// 'deal' is the overwhelmingly common case (in practice, nearly every
// link on a to-do/expense/debt/project IS "which deal is this for") so
// it gets its own prominent dropdown; the other five sit behind a
// "Link to something else" toggle instead of six selects competing for
// attention every time, most of them empty.
const LINK_PICKER_PRIMARY_TYPE = 'deal';
const LINK_PICKER_SECONDARY_TYPES = ['project', 'contact', 'referral', 'entity', 'invoice'];
const LINK_PICKER_TYPES = [LINK_PICKER_PRIMARY_TYPE].concat(LINK_PICKER_SECONDARY_TYPES);

// One flat list of { id, label, dealId? } for a given link type — same
// underlying data searchLinkableItems() draws from, just not filtered by
// a search term since every item is offered directly in its own <select>.
function linkableItemsForType(type) {
  if (type === 'deal') {
    return getDeals().map(d => ({ id: d.id, label: d.entityName || 'Untitled entity' }));
  }
  if (type === 'project') {
    return (typeof getProjects === 'function' ? getProjects() : []).map(p => ({ id: p.id, label: p.name || 'Untitled project' }));
  }
  if (type === 'contact') {
    return (typeof buildContactGroups === 'function' ? buildContactGroups() : []).map(g => ({ id: contactKeyOf(g.name, g.number), label: g.name }));
  }
  if (type === 'referral') {
    return (typeof buildReferralGroups === 'function' ? buildReferralGroups() : []).map(g => ({ id: g.name.toLowerCase(), label: g.name }));
  }
  if (type === 'entity') {
    return (typeof buildEntityGroups === 'function' ? buildEntityGroups() : []).map(g => ({ id: g.name.toLowerCase(), label: g.name }));
  }
  if (type === 'invoice') {
    return (typeof getAllInvoicesFlat === 'function' ? getAllInvoicesFlat() : []).map(({ deal, invoice }) =>
      ({ id: invoice.id, dealId: deal.id, label: invoice.number + ' · ' + (deal.entityName || 'Untitled entity') })
    );
  }
  return [];
}

/* ============================================================
   createLinkPicker({ container, chipsEl }) — a prominent "Deal"
   dropdown (the common case) plus a "Link to something else"
   toggle that reveals the other five types (Project/Contact/
   Referral/Entity/Invoice) as their own inline <select> dropdowns,
   plus a free-text field for custom tags. Picking an option from
   any dropdown adds that link immediately and resets the dropdown
   to its placeholder — no search step, no checkbox panel. Clicking
   a chip's label (not its remove button) opens that item's details.
   ============================================================ */
function createLinkPicker(opts) {
  const container = opts.container;
  const chipsEl = opts.chipsEl;
  let links = [];
  const selects = {};
  let customInput = null;
  let morePanel = null;
  let moreToggle = null;

  function isSelected(item) {
    return links.some(l => l.type === item.type && l.id === item.id);
  }

  function renderChips() {
    if (links.length === 0) {
      chipsEl.innerHTML = '<span class="no-referral">Nothing linked yet.</span>';
      return;
    }
    chipsEl.innerHTML = links.map((l, i) => {
      const meta = LINK_TYPE_META[l.type] || LINK_TYPE_META.custom;
      return '<span class="link-chip">' +
        '<button type="button" class="link-chip__label" data-open-link="' + i + '"><i class="bi ' + meta.icon + '"></i>' + escapeHtml(l.label) + '</button>' +
        '<button type="button" class="link-chip__remove" data-remove-link="' + i + '" aria-label="Remove link"><i class="bi bi-x"></i></button>' +
      '</span>';
    }).join('');
  }

  function addLink(item) {
    if (isSelected(item)) return; // already linked — picking it again from the dropdown is a no-op
    links.push(item);
    renderChips();
  }

  function setMorePanelOpen(open) {
    if (!morePanel || !moreToggle) return;
    morePanel.classList.toggle('d-none', !open);
    moreToggle.classList.toggle('is-open', open);
    moreToggle.innerHTML = open
      ? '<i class="bi bi-dash-lg"></i> Hide other link types'
      : '<i class="bi bi-plus-lg"></i> Link to something else';
  }

  // Rebuilds one <select>'s <option> list from the current data (deals,
  // contacts, etc. change over time), preserving the placeholder as the
  // selected value so re-populating never leaves a stale item "chosen".
  function refreshSelect(type) {
    const sel = selects[type];
    if (!sel) return;
    const meta = LINK_TYPE_META[type];
    const items = linkableItemsForType(type);
    sel.innerHTML = '<option value="">' + (type === LINK_PICKER_PRIMARY_TYPE ? '+ Link a deal…' : '+ ' + meta.label + '…') + '</option>' +
      items.map(it => '<option value="' + escapeHtml(String(it.id)) + '">' + escapeHtml(it.label) + '</option>').join('');
    sel._items = items;
    sel.value = '';
  }

  function refreshAllSelects() {
    LINK_PICKER_TYPES.forEach(refreshSelect);
  }

  function buildDom() {
    container.innerHTML =
      '<div class="link-picker-primary">' +
        '<select class="form-select form-select-sm link-picker-select link-picker-select--primary" data-link-type="' + LINK_PICKER_PRIMARY_TYPE + '"></select>' +
        '<button type="button" class="link-picker-more-toggle" data-more-toggle><i class="bi bi-plus-lg"></i> Link to something else</button>' +
      '</div>' +
      '<div class="link-picker-dropdowns d-none" data-more-panel>' +
        LINK_PICKER_SECONDARY_TYPES.map(type => {
          const meta = LINK_TYPE_META[type];
          return '<select class="form-select form-select-sm link-picker-select" data-link-type="' + type + '" title="' + meta.label + '"></select>';
        }).join('') +
        '<div class="link-picker-custom">' +
          '<input type="text" class="form-control form-control-sm" placeholder="Custom tag…">' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" title="Add custom tag"><i class="bi bi-plus-lg"></i></button>' +
        '</div>' +
      '</div>';

    LINK_PICKER_TYPES.forEach(type => {
      const sel = container.querySelector('[data-link-type="' + type + '"]');
      selects[type] = sel;
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        const item = (sel._items || []).find(it => String(it.id) === sel.value);
        if (item) {
          const link = { type, id: item.id, label: item.label };
          if (type === 'invoice' && item.dealId) link.dealId = item.dealId;
          addLink(link);
        }
        sel.value = '';
      });
    });
    refreshAllSelects();

    morePanel = container.querySelector('[data-more-panel]');
    moreToggle = container.querySelector('[data-more-toggle]');
    moreToggle.addEventListener('click', () => setMorePanelOpen(morePanel.classList.contains('d-none')));

    customInput = container.querySelector('.link-picker-custom input');
    const customAddBtn = container.querySelector('.link-picker-custom button');
    function addCustomTag() {
      const text = customInput.value.trim();
      if (!text) return;
      addLink({ type: 'custom', id: 'custom-' + Date.now(), label: text });
      customInput.value = '';
    }
    customAddBtn.addEventListener('click', addCustomTag);
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); }
    });
  }

  buildDom();

  chipsEl.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-link]');
    if (removeBtn) {
      links.splice(Number(removeBtn.dataset.removeLink), 1);
      renderChips();
      return;
    }
    const openBtn = e.target.closest('[data-open-link]');
    if (openBtn) openLinkDetails(links[Number(openBtn.dataset.openLink)]);
  });

  return {
    getLinks: () => links.slice(),
    // Editing an item that already has a non-deal link (a contact, an
    // invoice, ...) shouldn't hide that from view behind a collapsed
    // toggle — auto-expand the "something else" panel whenever the
    // links being loaded in actually need it.
    setLinks: (arr) => {
      links = (arr || []).slice();
      renderChips();
      setMorePanelOpen(links.some(l => l.type !== LINK_PICKER_PRIMARY_TYPE));
    },
    reset: () => { links = []; if (customInput) customInput.value = ''; renderChips(); refreshAllSelects(); setMorePanelOpen(false); },
  };
}
