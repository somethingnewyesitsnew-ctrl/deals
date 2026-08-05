/* ============================================================
   documents.js
   ------------------------------------------------------------
   Documents live on the deal they belong to (deal.documents array
   — same pattern as commLog and invoices, see README "Data model").
   Two kinds of entry:
     - 'file'  — small file (<350KB) stored inline as a base64 data
                 URL. localStorage has a real per-origin size limit
                 (usually 5-10MB total), so this is capped hard —
                 it's meant for scanned signatures, short contracts,
                 not general file storage.
     - 'link'  — just a URL to a file hosted elsewhere (Google Drive,
                 Dropbox, etc.) — the right choice for anything bigger.

   Exposes: renderDocumentsSection(deal) — called by deals-detail.js
   ============================================================ */

const MAX_DOC_BYTES = 350 * 1024; // ~350KB per file — see header note

const documentModalEl = document.getElementById('documentModal');
const documentModal = new bootstrap.Modal(documentModalEl);
const docNameInput = document.getElementById('docName');
const docFileInput = document.getElementById('docFile');
const docUrlInput = document.getElementById('docUrl');
const saveDocumentBtn = document.getElementById('saveDocumentBtn');

const documentPreviewModalEl = document.getElementById('documentPreviewModal');
const documentPreviewModal = new bootstrap.Modal(documentPreviewModalEl);
const documentPreviewTitle = document.getElementById('documentPreviewTitle');
const documentPreviewBody = document.getElementById('documentPreviewBody');

let pendingDocumentDealId = null;

// ---------- Helpers ----------
function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function docIcon(doc) {
  if (doc.kind === 'link') return 'bi-link-45deg';
  const t = (doc.mimeType || '').toLowerCase();
  if (t.includes('pdf')) return 'bi-file-earmark-pdf';
  if (t.startsWith('image/')) return 'bi-file-earmark-image';
  if (t.includes('word') || t.includes('msword') || t.includes('officedocument.wordprocessing')) return 'bi-file-earmark-word';
  if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return 'bi-file-earmark-excel';
  return 'bi-file-earmark-text';
}

// ---------- Section renderer (called from deals-detail.js) ----------
function renderDocumentsSection(deal) {
  const docs = (deal.documents || []).slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  const rows = docs.map(doc => '' +
    '<div class="document-row">' +
      '<button type="button" class="document-row__main" data-view-doc="' + doc.id + '" title="' + escapeHtml(doc.name) + '">' +
        '<i class="bi ' + docIcon(doc) + ' document-row__icon"></i>' +
        '<span class="document-row__name">' + escapeHtml(doc.name) + '</span>' +
        '<span class="document-row__meta">' + (doc.kind === 'link' ? 'Link' : escapeHtml(formatBytes(doc.size))) + '</span>' +
        '<span class="document-row__date">' + escapeHtml(timeAgo(doc.addedAt) || '') + '</span>' +
      '</button>' +
      '<button type="button" class="document-row__remove" data-remove-doc="' + doc.id + '" aria-label="Remove document"><i class="bi bi-trash3"></i></button>' +
    '</div>'
  ).join('');

  return '' +
    '<div class="detail-card">' +
      '<div class="detail-card__head-row">' +
        '<h4><i class="bi bi-folder2-open"></i> Documents</h4>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" id="detailAddDocumentBtn" data-deal="' + deal.id + '"><i class="bi bi-plus-lg"></i> Add document</button>' +
      '</div>' +
      (docs.length ? '<div class="document-list">' + rows + '</div>' : '<p class="no-referral">No documents attached yet.</p>') +
    '</div>';
}

// ---------- Add-document modal ----------
function openDocumentModal(dealId) {
  pendingDocumentDealId = dealId;
  docNameInput.value = '';
  docFileInput.value = '';
  docUrlInput.value = '';
  documentModal.show();
}

function finishDocumentSave(dealId, documents) {
  saveDeal({ id: dealId, documents });
  documentModal.hide();
  renderEverything();
  if (typeof currentDetailDealId !== 'undefined' && currentDetailDealId === dealId && detailModalEl.classList.contains('show')) {
    openDetailModal(dealId);
  }
  showToast('Document added.');
}

saveDocumentBtn.addEventListener('click', () => {
  const dealId = pendingDocumentDealId;
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return;

  const file = docFileInput.files[0];
  const url = docUrlInput.value.trim();
  const name = docNameInput.value.trim();

  if (!file && !url) {
    docUrlInput.focus();
    showToast('Attach a file or paste a link first.');
    return;
  }
  if (file && file.size > MAX_DOC_BYTES) {
    showToast('That file is ' + formatBytes(file.size) + ' — files are capped around 350KB here. Paste a link instead for anything bigger.');
    return;
  }

  const documents = (deal.documents || []).slice();
  if (name) addOption('documentName', name);
  refreshAllDatalists();

  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      documents.push({
        id: crypto.randomUUID(),
        name: name || file.name,
        kind: 'file',
        dataUrl: reader.result,
        mimeType: file.type,
        size: file.size,
        addedAt: Date.now(),
      });
      finishDocumentSave(dealId, documents);
    };
    reader.onerror = () => showToast('Could not read that file — try again or use a link instead.');
    reader.readAsDataURL(file);
  } else {
    documents.push({
      id: crypto.randomUUID(),
      name: name || url,
      kind: 'link',
      url,
      addedAt: Date.now(),
    });
    finishDocumentSave(dealId, documents);
  }
});

// ---------- Preview modal ----------
function openDocumentPreview(doc) {
  documentPreviewTitle.textContent = doc.name;

  if (doc.kind === 'link') {
    documentPreviewBody.innerHTML =
      '<p class="dropdown-hint mb-3">This document is stored externally.</p>' +
      '<a class="btn btn-ink btn-sm" href="' + escapeHtml(doc.url) + '" target="_blank" rel="noopener">Open link <i class="bi bi-box-arrow-up-right ms-1"></i></a>';
  } else if ((doc.mimeType || '').startsWith('image/')) {
    documentPreviewBody.innerHTML =
      '<img src="' + doc.dataUrl + '" class="document-preview-image" alt="' + escapeHtml(doc.name) + '">' +
      '<a class="btn btn-outline-secondary btn-sm mt-3" href="' + doc.dataUrl + '" download="' + escapeHtml(doc.name) + '"><i class="bi bi-download me-1"></i>Download</a>';
  } else if ((doc.mimeType || '').includes('pdf')) {
    documentPreviewBody.innerHTML =
      '<iframe src="' + doc.dataUrl + '" class="document-preview-frame" title="' + escapeHtml(doc.name) + '"></iframe>' +
      '<a class="btn btn-outline-secondary btn-sm mt-3" href="' + doc.dataUrl + '" download="' + escapeHtml(doc.name) + '"><i class="bi bi-download me-1"></i>Download</a>';
  } else {
    documentPreviewBody.innerHTML =
      '<p class="dropdown-hint mb-3">Preview isn\'t available for this file type.</p>' +
      '<a class="btn btn-ink btn-sm" href="' + doc.dataUrl + '" download="' + escapeHtml(doc.name) + '"><i class="bi bi-download me-1"></i>Download</a>';
  }

  documentPreviewModal.show();
}

// ---------- Event delegation on the (static, re-rendered-in-place) detail body ----------
document.getElementById('detailBody').addEventListener('click', (e) => {
  const addBtn = e.target.closest('#detailAddDocumentBtn');
  if (addBtn) { openDocumentModal(addBtn.dataset.deal); return; }

  const removeBtn = e.target.closest('[data-remove-doc]');
  if (removeBtn) {
    const dealId = currentDetailDealId;
    const deal = getDeals().find(d => d.id === dealId);
    if (!deal) return;
    const documents = (deal.documents || []).filter(d => d.id !== removeBtn.dataset.removeDoc);
    saveDeal({ id: dealId, documents });
    renderEverything();
    openDetailModal(dealId);
    showToast('Document removed.');
    return;
  }

  const viewBtn = e.target.closest('[data-view-doc]');
  if (viewBtn) {
    const dealId = currentDetailDealId;
    const deal = getDeals().find(d => d.id === dealId);
    if (!deal) return;
    const doc = (deal.documents || []).find(d => d.id === viewBtn.dataset.viewDoc);
    if (doc) openDocumentPreview(doc);
  }
});
