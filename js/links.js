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
     - createLinkPicker({ inputEl, resultsEl, chipsEl })
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

// Close every open link-picker dropdown when clicking outside a picker.
document.addEventListener('click', (e) => {
  if (e.target.closest('.link-picker')) return;
  document.querySelectorAll('.link-picker__results:not(.d-none)').forEach(el => el.classList.add('d-none'));
});

/* ============================================================
   createLinkPicker — wires one input+results+chips trio into a
   full checkbox-style multi-select picker. Checking an item adds
   it; unchecking removes it; the dropdown stays open so multiple
   items can be picked in one go. Enter with no match adds
   whatever was typed as a free-form 'custom' link. Clicking a
   chip's label (not its remove button) opens that item's details.
   ============================================================ */
function createLinkPicker(opts) {
  const inputEl = opts.inputEl;
  const resultsEl = opts.resultsEl;
  const chipsEl = opts.chipsEl;
  let links = [];

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

  function renderResults() {
    const matches = searchLinkableItems(inputEl.value);
    if (matches.length === 0) {
      resultsEl.classList.add('d-none');
      return;
    }
    resultsEl.innerHTML = matches.map((m, i) => {
      const meta = LINK_TYPE_META[m.type] || LINK_TYPE_META.custom;
      const checked = isSelected(m);
      return '<button type="button" class="link-picker__item' + (checked ? ' is-checked' : '') + '" data-result-index="' + i + '">' +
        '<i class="bi ' + (checked ? 'bi-check-square-fill' : 'bi-square') + ' link-picker__checkbox"></i>' +
        '<i class="bi ' + meta.icon + '"></i>' +
        '<span>' + escapeHtml(m.label) + '</span>' +
        '<span class="link-picker__type">' + meta.label + '</span>' +
      '</button>';
    }).join('');
    resultsEl._matches = matches;
    resultsEl.classList.remove('d-none');
  }

  function toggle(item) {
    if (isSelected(item)) links = links.filter(l => !(l.type === item.type && l.id === item.id));
    else links.push(item);
    renderChips();
    renderResults();
  }

  inputEl.addEventListener('input', renderResults);
  inputEl.addEventListener('focus', renderResults);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const matches = resultsEl._matches || [];
    if (matches.length > 0 && !resultsEl.classList.contains('d-none')) {
      toggle(matches[0]);
    } else {
      const text = inputEl.value.trim();
      if (!text) return;
      toggle({ type: 'custom', id: 'custom-' + Date.now(), label: text });
      inputEl.value = '';
      resultsEl.classList.add('d-none');
    }
  });

  resultsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-result-index]');
    if (!btn) return;
    const matches = resultsEl._matches || [];
    const item = matches[Number(btn.dataset.resultIndex)];
    if (item) toggle(item);
    inputEl.focus(); // keep the dropdown open for picking more than one
  });

  chipsEl.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-link]');
    if (removeBtn) {
      links.splice(Number(removeBtn.dataset.removeLink), 1);
      renderChips();
      renderResults();
      return;
    }
    const openBtn = e.target.closest('[data-open-link]');
    if (openBtn) openLinkDetails(links[Number(openBtn.dataset.openLink)]);
  });

  return {
    getLinks: () => links.slice(),
    setLinks: (arr) => { links = (arr || []).slice(); renderChips(); },
    reset: () => { links = []; inputEl.value = ''; renderChips(); resultsEl.classList.add('d-none'); },
  };
}
