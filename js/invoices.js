/* ============================================================
   invoices.js
   ------------------------------------------------------------
   Invoices live on the deal they belong to (deal.invoices array —
   see README data model), same pattern as commLog. This file owns:
     - the invoice editor (line items, totals, notes)
     - rendering the "Invoices" section inside the deal detail view
     - the print-ready client-facing invoice document

   "Sharing with a client" = the print view + the browser's own
   Print → Save as PDF. No PDF library, no server.

   Exposes: renderInvoiceSection(deal) — called by deals-detail.js
   ============================================================ */

const invoiceEditorModalEl = document.getElementById('invoiceEditorModal');
const invoiceEditorModal = new bootstrap.Modal(invoiceEditorModalEl);
const invoiceEditorTitle = document.getElementById('invoiceEditorTitle');
const invoiceEditorForm = document.getElementById('invoiceEditorForm');
const invoiceEditDealId = document.getElementById('invoiceEditDealId');
const invoiceEditId = document.getElementById('invoiceEditId');
const invoiceNumberInput = document.getElementById('invoiceNumber');
const invoiceDateInput = document.getElementById('invoiceDate');
const invoiceDueDateInput = document.getElementById('invoiceDueDate');
const invoiceCurrencyInput = document.getElementById('invoiceCurrency');
const invoiceStatusInput = document.getElementById('invoiceStatus');
const invoiceItemsBody = document.getElementById('invoiceItemsBody');
const addInvoiceItemBtn = document.getElementById('addInvoiceItemBtn');
const addExtraChargeBtn = document.getElementById('addExtraChargeBtn');
const invoiceEditorTotal = document.getElementById('invoiceEditorTotal');
const invoiceNotesInput = document.getElementById('invoiceNotes');
const invoiceEditorDeleteBtn = document.getElementById('invoiceEditorDeleteBtn');

const invoicePrintModalEl = document.getElementById('invoicePrintModal');
const invoicePrintModal = new bootstrap.Modal(invoicePrintModalEl);
const invoicePrintTitle = document.getElementById('invoicePrintTitle');
const invoicePrintBody = document.getElementById('invoicePrintBody');
const printInvoiceBtn = document.getElementById('printInvoiceBtn');
const downloadInvoicePdfBtn = document.getElementById('downloadInvoicePdfBtn');
const editInvoiceTemplateLink = document.getElementById('editInvoiceTemplateLink');

const invoiceTemplateModalEl = document.getElementById('invoiceTemplateModal');
const invoiceTemplateModal = new bootstrap.Modal(invoiceTemplateModalEl);
const invoiceTemplateLogoInput = document.getElementById('invoiceTemplateLogoInput');
const invoiceTemplateLogoPreview = document.getElementById('invoiceTemplateLogoPreview');
const invoiceTemplateLogoEmpty = document.getElementById('invoiceTemplateLogoEmpty');
const removeInvoiceTemplateLogoBtn = document.getElementById('removeInvoiceTemplateLogoBtn');
const invoiceTemplateCompanyName = document.getElementById('invoiceTemplateCompanyName');
const invoiceTemplateCompanyDetails = document.getElementById('invoiceTemplateCompanyDetails');
const invoiceTemplateFooter = document.getElementById('invoiceTemplateFooter');
const saveInvoiceTemplateBtn = document.getElementById('saveInvoiceTemplateBtn');

let pendingTemplateLogo = null; // set while editing, committed on Save

let invoiceItems = [];
let currentPrintDealId = null;
let currentPrintInvoiceId = null;

const INVOICE_STATUS_LABELS = { draft: 'Draft', sent: 'Sent', paid: 'Paid' };

function formatInvoiceAmount(amount, currency) {
  amount = Number(amount) || 0;
  return currency === 'SDG' ? sdgFormatter.format(amount) + ' SDG' : usdFormatter.format(amount);
}

function invoiceTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
}

// The deal's value, converted into whatever currency the invoice is in —
// what "%" is calculated against. Set whenever the editor opens.
let invoiceEditorDealValue = 0;

// ---------- Line item editor ----------
function renderInvoiceItems() {
  invoiceItemsBody.innerHTML = invoiceItems.map(it => '' +
    '<div class="invoice-items-row' + (it.isExtra ? ' invoice-items-row--extra' : '') + '" data-id="' + it.id + '"' + (it.isExtra ? ' data-extra="1"' : '') + '>' +
      '<input type="text" class="form-control form-control-sm invoice-item-desc" list="invoiceDescOptionsList" value="' + escapeHtml(it.description) + '" placeholder="' + (it.isExtra ? 'Extra feature, add-on service…' : 'Website, downpayment…') + '">' +
      (it.isExtra
        ? '<span class="invoice-item-extra-tag" title="Extra charge — outside the contract %, doesn\'t affect other lines"><i class="bi bi-stars"></i> Extra</span>'
        : '<input type="number" class="form-control form-control-sm invoice-item-percent" value="' + (it.percent || '') + '" min="0" max="100" step="1" placeholder="%">') +
      '<input type="number" class="form-control form-control-sm invoice-item-amount" value="' + it.amount + '" min="0" step="0.01">' +
      '<button type="button" class="invoice-item-remove" aria-label="Remove item"><i class="bi bi-x-lg"></i></button>' +
    '</div>'
  ).join('');
  updateInvoiceEditorTotal();
}

function updateInvoiceEditorTotal() {
  invoiceEditorTotal.textContent = formatInvoiceAmount(invoiceTotal(invoiceItems), invoiceCurrencyInput.value);
}

function syncInvoiceItemsFromDOM() {
  invoiceItemsBody.querySelectorAll('.invoice-items-row').forEach(row => {
    const id = row.dataset.id;
    const item = invoiceItems.find(it => it.id === id);
    if (!item) return;
    item.description = row.querySelector('.invoice-item-desc').value;
    if (item.isExtra) {
      item.percent = null;
    } else {
      const percentInput = row.querySelector('.invoice-item-percent');
      item.percent = percentInput ? (Number(percentInput.value) || 0) : 0;
    }
    item.amount = Number(row.querySelector('.invoice-item-amount').value) || 0;
  });
}

addInvoiceItemBtn.addEventListener('click', () => {
  syncInvoiceItemsFromDOM();
  invoiceItems.push({ id: crypto.randomUUID(), description: '', percent: 0, amount: 0 });
  renderInvoiceItems();
});

// "Extra charge" = something outside the original contract value (an add-on
// feature, extra service the client asked for, etc.) — it's just a flat
// amount and deliberately never factors into any %-of-deal-value math, so
// adding one can't skew the % shown on the invoice's other lines.
addExtraChargeBtn.addEventListener('click', () => {
  syncInvoiceItemsFromDOM();
  invoiceItems.push({ id: crypto.randomUUID(), description: '', percent: null, amount: 0, isExtra: true });
  renderInvoiceItems();
});

invoiceItemsBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.invoice-item-remove');
  if (!btn) return;
  syncInvoiceItemsFromDOM();
  const id = btn.closest('.invoice-items-row').dataset.id;
  invoiceItems = invoiceItems.filter(it => it.id !== id);
  // Never leave the editor with zero rows — a saved invoice with no line
  // items is a $0 invoice nobody meant to create.
  if (invoiceItems.length === 0) {
    invoiceItems.push({ id: crypto.randomUUID(), description: '', percent: 0, amount: 0 });
  }
  renderInvoiceItems();
});

// Typing a % auto-fills the amount from the deal value; typing an amount
// directly leaves % alone (they're two ways to fill the same field, not
// two numbers that must always agree — editing amount doesn't back-solve %).
// Editing % fills the amount from the deal value; editing the amount
// back-solves the % — either field can drive the other. Extra-charge rows
// have no % input at all, so neither half of this applies to them.
invoiceItemsBody.addEventListener('input', (e) => {
  const row = e.target.closest('.invoice-items-row');
  if (!row || row.dataset.extra) {
    if (row) { syncInvoiceItemsFromDOM(); updateInvoiceEditorTotal(); }
    return;
  }

  if (e.target.classList.contains('invoice-item-percent')) {
    const percent = Number(e.target.value) || 0;
    const amount = Math.round((percent / 100) * invoiceEditorDealValue * 100) / 100;
    row.querySelector('.invoice-item-amount').value = amount;
  } else if (e.target.classList.contains('invoice-item-amount') && invoiceEditorDealValue > 0) {
    const amount = Number(e.target.value) || 0;
    const percent = Math.round((amount / invoiceEditorDealValue) * 1000) / 10;
    row.querySelector('.invoice-item-percent').value = percent;
  }

  syncInvoiceItemsFromDOM();
  updateInvoiceEditorTotal();
});

invoiceCurrencyInput.addEventListener('change', () => {
  invoiceEditorDealValue = valueInCurrency(invoiceEditorDealDeal.value, invoiceEditorDealDeal.currency, invoiceCurrencyInput.value);
  renderInvoiceItems();
});

// ---------- Open editor (new or edit existing) ----------
let invoiceEditorDealDeal = null; // the deal object currently being invoiced

function openInvoiceEditor(dealId, invoiceId) {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;
  invoiceEditorDealDeal = deal;

  invoiceEditDealId.value = dealId;
  invoiceEditId.value = invoiceId || '';

  const existing = invoiceId ? (deal.invoices || []).find(inv => inv.id === invoiceId) : null;

  if (existing) {
    invoiceEditorTitle.textContent = 'Edit invoice — ' + existing.number;
    invoiceNumberInput.value = existing.number;
    invoiceDateInput.value = existing.date || '';
    invoiceDueDateInput.value = existing.dueDate || '';
    invoiceCurrencyInput.value = existing.currency || deal.currency || 'USD';
    invoiceStatusInput.value = existing.status || 'draft';
    invoiceNotesInput.value = existing.notes || '';
    invoiceItems = (existing.items || []).map(it => Object.assign({ percent: 0 }, it));
    invoiceEditorDeleteBtn.classList.remove('d-none');
  } else {
    invoiceEditorTitle.textContent = 'New invoice — ' + (deal.entityName || 'Untitled entity');
    invoiceNumberInput.value = getNextInvoiceNumber();
    invoiceDateInput.value = new Date().toISOString().slice(0, 10);
    invoiceDueDateInput.value = '';
    invoiceCurrencyInput.value = deal.currency || 'USD';
    invoiceStatusInput.value = 'draft';
    invoiceNotesInput.value = '';
    invoiceItems = [{
      id: crypto.randomUUID(),
      description: deal.requirement || deal.fieldOfWork || '',
      percent: 100,
      amount: Number(deal.value) || 0,
    }];
    invoiceEditorDeleteBtn.classList.add('d-none');
  }

  invoiceEditorDealValue = valueInCurrency(deal.value, deal.currency, invoiceCurrencyInput.value);
  renderInvoiceItems();
  invoiceEditorModal.show();
}

invoiceEditorForm.addEventListener('submit', (e) => {
  e.preventDefault();
  syncInvoiceItemsFromDOM();

  const dealId = invoiceEditDealId.value;
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;

  const nonEmptyItems = invoiceItems.filter(it => it.description.trim() || it.amount);
  if (nonEmptyItems.length === 0) {
    showToast('Add at least one line item before saving.');
    invoiceItemsBody.querySelector('.invoice-item-desc')?.focus();
    return;
  }

  invoiceItems.forEach(it => { if (it.description.trim()) addOption('invoiceDescriptions', it.description.trim()); });
  refreshAllDatalists();

  const invoiceId = invoiceEditId.value;
  const invoices = (deal.invoices || []).slice();
  const payload = {
    id: invoiceId || crypto.randomUUID(),
    number: invoiceNumberInput.value.trim() || getNextInvoiceNumber(),
    date: invoiceDateInput.value,
    dueDate: invoiceDueDateInput.value,
    currency: invoiceCurrencyInput.value,
    items: nonEmptyItems,
    notes: invoiceNotesInput.value.trim(),
    status: invoiceStatusInput.value || 'draft',
    createdAt: invoiceId ? ((invoices.find(inv => inv.id === invoiceId) || {}).createdAt || Date.now()) : Date.now(),
  };

  const idx = invoices.findIndex(inv => inv.id === payload.id);
  if (idx >= 0) invoices[idx] = payload; else invoices.push(payload);

  saveDeal({ id: dealId, invoices });
  invoiceEditorModal.hide();
  renderEverything();

  if (typeof currentDetailDealId !== 'undefined' && currentDetailDealId === dealId && detailModalEl.classList.contains('show')) {
    openDetailModal(dealId);
  }
  showToast(invoiceId ? 'Invoice updated.' : 'Invoice created.');
});

// ---------- Status change (draft / sent / paid) ----------
function setInvoiceStatus(dealId, invoiceId, status) {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;
  const invoices = (deal.invoices || []).map(inv => inv.id === invoiceId ? Object.assign({}, inv, { status }) : inv);
  saveDeal({ id: dealId, invoices });
  renderEverything();
  if (typeof currentDetailDealId !== 'undefined' && currentDetailDealId === dealId && detailModalEl.classList.contains('show')) {
    openDetailModal(dealId);
  }
}

// ---------- Delete (invoice list rows, the editor, and the Financial tab all call this) ----------
function deleteInvoiceRecord(dealId, invoiceId) {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;
  const invoice = (deal.invoices || []).find(inv => inv.id === invoiceId);
  const label = invoice ? invoice.number : 'this invoice';
  if (!confirm('Delete ' + label + '? This can\'t be undone.')) return;

  const invoices = (deal.invoices || []).filter(inv => inv.id !== invoiceId);
  saveDeal({ id: dealId, invoices });
  renderEverything();
  if (typeof updateTabCounts === 'function') updateTabCounts();
  if (typeof currentDetailDealId !== 'undefined' && currentDetailDealId === dealId && detailModalEl.classList.contains('show')) {
    openDetailModal(dealId);
  }
  showToast('Invoice deleted.');
}

invoiceEditorDeleteBtn.addEventListener('click', () => {
  const dealId = invoiceEditDealId.value;
  const invoiceId = invoiceEditId.value;
  if (!dealId || !invoiceId) return;
  deleteInvoiceRecord(dealId, invoiceId);
  invoiceEditorModal.hide();
});

// ---------- Print / client-facing view ----------
function openInvoicePrintView(dealId, invoiceId) {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;
  const invoice = (deal.invoices || []).find(inv => inv.id === invoiceId);
  if (!invoice) return;

  currentPrintDealId = dealId;
  currentPrintInvoiceId = invoiceId;

  invoicePrintTitle.textContent = invoice.number;

  const total = invoiceTotal(invoice.items);
  const fc = deal.firstContact || {};
  const billToLines = [deal.entityName, fc.name, fc.email, fc.number].filter(Boolean).map(escapeHtml).join('<br>');

  const template = getInvoiceTemplate();
  const brandName = template.companyName ? escapeHtml(template.companyName) : 'I&amp;S Group';
  const brandLogo = template.logo ? '<img src="' + template.logo + '" class="invoice-doc-logo" alt="Logo">' : '<div class="invoice-doc-logo invoice-doc-logo--placeholder"><i class="bi bi-briefcase-fill"></i></div>';
  const brandDetails = template.companyDetails ? '<p class="invoice-doc-brand-details">' + escapeHtml(template.companyDetails).replace(/\n/g, '<br>') + '</p>' : '';

  const statusTone = invoice.status === 'paid' ? 'paid' : invoice.status === 'sent' ? 'sent' : 'draft';
  const statusLabel = INVOICE_STATUS_LABELS[invoice.status] || 'Draft';

  const rows = (invoice.items || []).map(it => '' +
    '<tr>' +
      '<td>' + escapeHtml(it.description || '') + (it.percent ? ' <span class="invoice-doc-percent">(' + it.percent + '%)</span>' : '') + '</td>' +
      '<td class="text-end">' + formatInvoiceAmount(it.amount, invoice.currency) + '</td>' +
    '</tr>'
  ).join('');

  invoicePrintBody.innerHTML =
    '<div class="invoice-printable">' +
      '<div class="invoice-doc-header">' +
        '<div class="invoice-doc-brand-block">' +
          brandLogo +
          '<div class="invoice-doc-brand">' + brandName + '</div>' +
          brandDetails +
        '</div>' +
        '<div class="invoice-doc-meta">' +
          '<h2>Invoice</h2>' +
          '<p class="invoice-doc-number">' + escapeHtml(invoice.number) + '</p>' +
          '<span class="invoice-doc-status invoice-doc-status--' + statusTone + '">' + statusLabel + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="invoice-doc-parties">' +
        '<div><span class="invoice-doc-label">Bill to</span><br>' + (billToLines || '<span class="no-referral">—</span>') + '</div>' +
        '<div class="invoice-doc-dates"><span class="invoice-doc-label">Date</span> ' + (invoice.date || '—') + '<br>' +
             '<span class="invoice-doc-label">Due</span> ' + (invoice.dueDate || '—') +
        '</div>' +
      '</div>' +
      '<table class="invoice-doc-table"><thead><tr><th>Description</th><th class="text-end">Amount</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="invoice-doc-total"><span>Total</span><strong>' + formatInvoiceAmount(total, invoice.currency) + '</strong></div>' +
      (invoice.notes ? '<div class="invoice-doc-notes"><span class="invoice-doc-label">Notes</span><p>' + escapeHtml(invoice.notes) + '</p></div>' : '') +
      (template.footer ? '<div class="invoice-doc-footer">' + escapeHtml(template.footer).replace(/\n/g, '<br>') + '</div>' : '') +
    '</div>';

  invoicePrintModal.show();
}

printInvoiceBtn.addEventListener('click', () => window.print());

downloadInvoicePdfBtn.addEventListener('click', () => {
  const sourceEl = invoicePrintBody.querySelector('.invoice-printable');
  if (!sourceEl || typeof html2pdf === 'undefined') return;

  const deal = getDeals().find(d => d.id === currentPrintDealId);
  const invoice = deal ? (deal.invoices || []).find(inv => inv.id === currentPrintInvoiceId) : null;
  const filename = (invoice ? invoice.number : 'invoice') + '.pdf';

  downloadInvoicePdfBtn.disabled = true;
  const originalHtml = downloadInvoicePdfBtn.innerHTML;
  downloadInvoicePdfBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Preparing…';

  // The stretched/squished PDF was html2canvas capturing the element AS IT
  // SITS in the modal — a fluid-width, potentially still-animating
  // container, so its measured width varied. Rendering into a detached,
  // off-screen clone with a hard-coded pixel width fixes that: html2canvas
  // always measures the exact same box, every time, regardless of the
  // modal's current size or viewport.
  const PDF_WIDTH_PX = 800;
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.top = '0';
  wrapper.style.left = '-99999px';
  wrapper.style.width = PDF_WIDTH_PX + 'px';
  wrapper.style.background = '#fff';

  const clone = sourceEl.cloneNode(true);
  clone.style.width = PDF_WIDTH_PX + 'px';
  clone.style.maxWidth = 'none';
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  // Both previous bugs (squished-into-left-half, then overflowing off the
  // right edge) traced back to the same root cause: html2pdf's automatic
  // canvas→page mm-conversion math being unreliable once `scale` is
  // involved. Rather than keep guessing at that math, we remove it from
  // the equation entirely — measure the clone's real pixel size and set
  // the PDF page format to those exact px dimensions (unit: 'px'), so the
  // captured image is placed onto the page 1:1 with nothing left to scale
  // or fit incorrectly.
  const contentHeightPx = Math.ceil(clone.scrollHeight);

  html2pdf().set({
    margin: 0,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'px', format: [PDF_WIDTH_PX, contentHeightPx], orientation: 'portrait' },
  }).from(clone).save().then(() => {
    document.body.removeChild(wrapper);
    downloadInvoicePdfBtn.disabled = false;
    downloadInvoicePdfBtn.innerHTML = originalHtml;
  }).catch(() => {
    document.body.removeChild(wrapper);
    downloadInvoicePdfBtn.disabled = false;
    downloadInvoicePdfBtn.innerHTML = originalHtml;
    showToast('Could not generate the PDF — try Print instead.');
  });
});

// ---------- Invoice template (logo + company details, upload once) ----------
function openInvoiceTemplateModal() {
  const template = getInvoiceTemplate();
  pendingTemplateLogo = template.logo || null;
  invoiceTemplateCompanyName.value = template.companyName || '';
  invoiceTemplateCompanyDetails.value = template.companyDetails || '';
  invoiceTemplateFooter.value = template.footer || '';
  updateTemplateLogoPreview();
  invoiceTemplateModal.show();
}

function updateTemplateLogoPreview() {
  if (pendingTemplateLogo) {
    invoiceTemplateLogoPreview.src = pendingTemplateLogo;
    invoiceTemplateLogoPreview.classList.remove('d-none');
    invoiceTemplateLogoEmpty.classList.add('d-none');
    removeInvoiceTemplateLogoBtn.classList.remove('d-none');
  } else {
    invoiceTemplateLogoPreview.classList.add('d-none');
    invoiceTemplateLogoEmpty.classList.remove('d-none');
    removeInvoiceTemplateLogoBtn.classList.add('d-none');
  }
}

invoiceTemplateLogoInput.addEventListener('change', () => {
  const file = invoiceTemplateLogoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingTemplateLogo = reader.result;
    updateTemplateLogoPreview();
  };
  reader.readAsDataURL(file);
});

removeInvoiceTemplateLogoBtn.addEventListener('click', () => {
  pendingTemplateLogo = null;
  invoiceTemplateLogoInput.value = '';
  updateTemplateLogoPreview();
});

saveInvoiceTemplateBtn.addEventListener('click', () => {
  setInvoiceTemplate({
    logo: pendingTemplateLogo,
    companyName: invoiceTemplateCompanyName.value.trim(),
    companyDetails: invoiceTemplateCompanyDetails.value.trim(),
    footer: invoiceTemplateFooter.value.trim(),
  });
  invoiceTemplateModal.hide();
  showToast('Invoice template saved.');
  // If an invoice is currently open in the print view, refresh it with the new branding.
  if (currentPrintDealId && currentPrintInvoiceId && invoicePrintModalEl.classList.contains('show')) {
    openInvoicePrintView(currentPrintDealId, currentPrintInvoiceId);
  }
});

editInvoiceTemplateLink.addEventListener('click', openInvoiceTemplateModal);

// ---------- Generate invoices from the deal's payment breakdown ----------
function generateInvoicesFromBreakdown(dealId) {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal || !(deal.paymentBreakdown || []).length) return;

  const invoices = (deal.invoices || []).slice();
  const existingSourceIds = new Set(invoices.map(inv => inv.sourceBreakdownId).filter(Boolean));
  const toCreate = deal.paymentBreakdown.filter(pb => !existingSourceIds.has(pb.id));

  if (!toCreate.length) {
    showToast('Every payment stage already has an invoice.');
    return;
  }

  toCreate.forEach(pb => {
    const amount = Math.round((Number(pb.percent) / 100) * Number(deal.value || 0) * 100) / 100;
    invoices.push({
      id: crypto.randomUUID(),
      number: getNextInvoiceNumber(),
      date: new Date().toISOString().slice(0, 10),
      dueDate: '',
      currency: deal.currency || 'USD',
      items: [{ id: crypto.randomUUID(), description: pb.label, percent: pb.percent, amount }],
      notes: '',
      status: 'draft',
      sourceBreakdownId: pb.id,
      createdAt: Date.now(),
    });
  });

  saveDeal({ id: dealId, invoices });
  renderEverything();
  if (typeof currentDetailDealId !== 'undefined' && currentDetailDealId === dealId && detailModalEl.classList.contains('show')) {
    openDetailModal(dealId);
  }
  showToast(toCreate.length + (toCreate.length === 1 ? ' invoice' : ' invoices') + ' created from the payment breakdown.');
}

// ---------- Detail-view section (called by deals-detail.js) ----------
function renderInvoiceSection(deal) {
  const invoices = deal.invoices || [];
  const breakdown = deal.paymentBreakdown || [];
  const existingSourceIds = new Set(invoices.map(inv => inv.sourceBreakdownId).filter(Boolean));
  const pendingBreakdown = breakdown.filter(pb => !existingSourceIds.has(pb.id));

  const rows = invoices.slice().sort((a, b) => b.createdAt - a.createdAt).map(inv => {
    const total = invoiceTotal(inv.items);
    return '' +
      '<div class="invoice-row">' +
        '<button type="button" class="invoice-row__main" data-view-invoice="' + inv.id + '">' +
          '<span class="invoice-row__number">' + escapeHtml(inv.number) + '</span>' +
          '<span class="invoice-row__amount">' + formatInvoiceAmount(total, inv.currency) + '</span>' +
          '<span class="status-badge status-badge--' + (inv.status === 'paid' ? 'done' : inv.status === 'sent' ? 'scheduled' : 'note') + '">' + (INVOICE_STATUS_LABELS[inv.status] || 'Draft') + '</span>' +
        '</button>' +
        '<div class="invoice-row__actions">' +
          '<button type="button" class="invoice-status-btn" data-deal="' + deal.id + '" data-invoice="' + inv.id + '" data-status="sent" title="Mark sent"><i class="bi bi-send"></i></button>' +
          '<button type="button" class="invoice-status-btn" data-deal="' + deal.id + '" data-invoice="' + inv.id + '" data-status="paid" title="Mark paid"><i class="bi bi-check-circle"></i></button>' +
          (inv.status !== 'draft' ? '<button type="button" class="invoice-status-btn" data-deal="' + deal.id + '" data-invoice="' + inv.id + '" data-status="draft" title="Mark unpaid / draft"><i class="bi bi-arrow-counterclockwise"></i></button>' : '') +
          '<button type="button" class="edit-invoice-btn" data-deal="' + deal.id + '" data-invoice="' + inv.id + '" title="Edit"><i class="bi bi-pencil"></i></button>' +
          '<button type="button" class="delete-invoice-btn" data-deal="' + deal.id + '" data-invoice="' + inv.id + '" title="Delete"><i class="bi bi-trash3"></i></button>' +
        '</div>' +
      '</div>';
  }).join('');

  return '' +
    '<div class="detail-card">' +
      '<div class="detail-card__head-row">' +
        '<h4><i class="bi bi-receipt"></i> Invoices</h4>' +
        '<div class="d-flex gap-2">' +
          (pendingBreakdown.length
            ? '<button type="button" class="btn btn-sm btn-outline-secondary" id="detailGenerateInvoicesBtn" data-deal="' + deal.id + '"><i class="bi bi-magic"></i> Generate ' + pendingBreakdown.length + ' from breakdown</button>'
            : '') +
          '<button type="button" class="btn btn-sm btn-outline-secondary" id="detailNewInvoiceBtn" data-deal="' + deal.id + '"><i class="bi bi-plus-lg"></i> Create invoice</button>' +
        '</div>' +
      '</div>' +
      (invoices.length ? '<div class="invoice-list">' + rows + '</div>' : '<p class="no-referral">No invoices yet.</p>') +
    '</div>';
}

// Event delegation on the detail body — invoice rows are re-rendered every
// time the detail modal opens, so listeners live on the (static) container.
document.getElementById('detailBody').addEventListener('click', (e) => {
  const viewBtn = e.target.closest('[data-view-invoice]');
  if (viewBtn) { openInvoicePrintView(currentDetailDealId, viewBtn.dataset.viewInvoice); return; }

  const newBtn = e.target.closest('#detailNewInvoiceBtn');
  if (newBtn) { openInvoiceEditor(newBtn.dataset.deal); return; }

  const generateBtn = e.target.closest('#detailGenerateInvoicesBtn');
  if (generateBtn) { generateInvoicesFromBreakdown(generateBtn.dataset.deal); return; }

  const editBtn = e.target.closest('.edit-invoice-btn');
  if (editBtn) { openInvoiceEditor(editBtn.dataset.deal, editBtn.dataset.invoice); return; }

  const statusBtn = e.target.closest('.invoice-status-btn');
  if (statusBtn) { setInvoiceStatus(statusBtn.dataset.deal, statusBtn.dataset.invoice, statusBtn.dataset.status); return; }

  const deleteBtn = e.target.closest('.delete-invoice-btn');
  if (deleteBtn) { deleteInvoiceRecord(deleteBtn.dataset.deal, deleteBtn.dataset.invoice); return; }
});
