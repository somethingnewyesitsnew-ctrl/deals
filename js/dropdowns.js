/* ============================================================
   dropdowns.js
   ------------------------------------------------------------
   "Editable dropdown" fields (relation, channel, action, next
   step) are plain <input list="..."> elements paired with a
   <datalist>. That gives native dropdown-with-typeahead
   behaviour everywhere, including opening the file straight
   off disk. Typing a new value and saving the form persists it
   (see saveNewOptionsFromForm) so it shows up next time.

   Exposes:
     - populateDatalist(datalistId, key)
     - refreshAllDatalists()
     - saveNewOptionsFromForm(fieldIdToKeyMap)
   ============================================================ */

function populateDatalist(datalistId, key) {
  const dl = document.getElementById(datalistId);
  if (!dl) return;
  dl.innerHTML = getOptions(key).map(o => '<option value="' + escapeHtml(o) + '">').join('');
}

function refreshAllDatalists() {
  populateDatalist('relationOptionsList', 'relation');
  populateDatalist('requirementOptionsList', 'requirement');
  populateDatalist('servicesOptionsList', 'services');
  populateDatalist('invoiceDescOptionsList', 'invoiceDescriptions');
  populateDatalist('channelOptionsList', 'channel');
  populateDatalist('actionOptionsList', 'action');
  populateDatalist('nextStepOptionsList', 'nextstep');
  populateDatalist('expenseCategoryOptionsList', 'expenseCategory');
  populateDatalist('incomeSourceOptionsList', 'incomeSource');
  populateDatalist('expenseDescriptionOptionsList', 'expenseDescription');
  populateDatalist('documentNameOptionsList', 'documentName');
  populateDatalist('fieldOfWorkOptionsList', 'fieldOfWork');
  populateDatalist('nationalityOptionsList', 'nationality');
  populateDatalist('currentLocationOptionsList', 'currentLocation');
  populateDatalist('reasonEndedOptionsList', 'reasonEnded');
  populateDatalist('specialInstructionsOptionsList', 'specialInstructions');
  populateDatalist('personNameOptionsList', 'personName');

  const entityDl = document.getElementById('entityNamesList');
  if (entityDl) entityDl.innerHTML = getEntityNames().map(n => '<option value="' + escapeHtml(n) + '">').join('');
}

// fieldIdToKeyMap: { inputElementId: optionsKey }
// Reads the current value of each input and, if non-empty, saves it as a
// remembered option for that key, then refreshes the datalists.
function saveNewOptionsFromForm(fieldIdToKeyMap) {
  Object.keys(fieldIdToKeyMap).forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const value = el.value.trim();
    if (value) addOption(fieldIdToKeyMap[fieldId], value);
  });
  refreshAllDatalists();
}
