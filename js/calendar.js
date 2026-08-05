/* ============================================================
   calendar.js
   ------------------------------------------------------------
   A month-grid view of every update across every deal. Nothing
   is stored here either — it reads the same commLog entries the
   Deals table and detail view use, grouped by day via
   entryDateKey() (see updates.js).

   Depends on: storage.js, updates.js (entryDateKey, statusBadge,
   STATUS_LABELS), deals.js (openDetailModal), app.js (switchView).

   Exposes: renderCalendar()
   ============================================================ */

const calTitle = document.getElementById('calTitle');
const calendarGrid = document.getElementById('calendarGrid');
const calPrevBtn = document.getElementById('calPrevBtn');
const calNextBtn = document.getElementById('calNextBtn');
const calTodayBtn = document.getElementById('calTodayBtn');

const dayUpdatesModalEl = document.getElementById('dayUpdatesModal');
const dayUpdatesModal = new bootstrap.Modal(dayUpdatesModalEl);
const dayUpdatesTitle = document.getElementById('dayUpdatesTitle');
const dayUpdatesBody = document.getElementById('dayUpdatesBody');

let calCurrentMonth = firstOfMonth(new Date());

function firstOfMonth(d) {
  const copy = new Date(d.getFullYear(), d.getMonth(), 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Local YYYY-MM-DD — avoids the UTC shift toISOString() would introduce.
function dateKeyOf(year, month, day) {
  return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function buildCalendarEntries() {
  const map = new Map();

  function add(key, item) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }

  getDeals().forEach(deal => {
    (deal.commLog || []).forEach(entry => {
      add(entryDateKey(entry), {
        dealId: deal.id,
        entityName: deal.entityName || 'Untitled entity',
        note: entry.note || entry.action || entry.channel || 'Update',
        status: entry.status || '',
        kind: 'logged',
      });
      // A next-step date is a separate calendar entry from the day the
      // update itself was logged — it's a future thing to do, not a past
      // interaction, so it gets its own chip on its own day.
      if (entry.nextStepDate) {
        add(entry.nextStepDate, {
          dealId: deal.id,
          entityName: deal.entityName || 'Untitled entity',
          note: entry.nextStep || 'Follow up',
          status: entry.status || '',
          kind: 'followup',
        });
      }
    });
  });

  getAllContactUpdatesFlat().forEach(entry => {
    const name = entry.contactName || entry.contactKey.split('|')[0];
    add(entryDateKey(entry), {
      contactKey: entry.contactKey,
      entityName: name,
      note: entry.note || entry.channel || 'Update',
      status: entry.status || '',
      kind: 'logged',
    });
    if (entry.nextStepDate) {
      add(entry.nextStepDate, {
        contactKey: entry.contactKey,
        entityName: name,
        note: entry.nextStep || 'Follow up',
        status: entry.status || '',
        kind: 'followup',
      });
    }
  });

  return map;
}

function renderCalendar() {
  calTitle.textContent = calCurrentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const entries = buildCalendarEntries();
  const year = calCurrentMonth.getFullYear();
  const month = calCurrentMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const now = new Date();
  const todayKey = dateKeyOf(now.getFullYear(), now.getMonth(), now.getDate());

  const cells = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({ num: daysInPrevMonth - i, key: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ num: d, key: dateKeyOf(year, month, d) });
  }
  let trail = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ num: trail++, key: null });
  }

  const weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map(w => '<div class="cal-weekday">' + w + '</div>').join('');

  const dayCells = cells.map(cell => {
    if (!cell.key) {
      return '<div class="cal-day cal-day--muted"><span class="cal-day__num">' + cell.num + '</span></div>';
    }
    const dayEntries = entries.get(cell.key) || [];
    const isToday = cell.key === todayKey;
    const chips = dayEntries.slice(0, 3).map(e => {
      const chipClass = e.kind === 'followup' ? 'followup' : (e.status || 'note');
      const icon = e.kind === 'followup' ? '<i class="bi bi-bell-fill"></i> ' : '';
      return '<div class="cal-chip cal-chip--' + chipClass + '" title="' + escapeHtml(e.entityName + ': ' + e.note) + '">' + icon + escapeHtml(e.entityName) + '</div>';
    }).join('');
    const overflow = dayEntries.length > 3 ? '<div class="cal-overflow">+' + (dayEntries.length - 3) + ' more</div>' : '';

    return '<button type="button" class="cal-day' + (isToday ? ' cal-day--today' : '') + (dayEntries.length ? ' cal-day--has-items' : '') + '" data-date="' + cell.key + '">' +
      '<span class="cal-day__num">' + cell.num + '</span>' +
      (dayEntries.length ? '<div class="cal-day__chips">' + chips + overflow + '</div>' : '') +
    '</button>';
  }).join('');

  calendarGrid.innerHTML = weekdayHeaders + dayCells;
}

function openDayUpdatesModal(dateKey) {
  const entries = buildCalendarEntries().get(dateKey) || [];
  const d = new Date(dateKey + 'T00:00:00');
  dayUpdatesTitle.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  dayUpdatesBody.innerHTML = entries.length
    ? '<div class="attention-list">' + entries.map(e =>
        '<button type="button" class="attention-row" ' + (e.dealId ? 'data-id="' + e.dealId + '"' : 'data-contact-key="' + escapeHtml(e.contactKey) + '" data-contact-name="' + escapeHtml(e.entityName) + '"') + '>' +
          '<span class="attention-row__name">' + escapeHtml(e.entityName) + '</span>' +
          (e.kind === 'followup' ? '<span class="status-badge status-badge--scheduled"><i class="bi bi-bell-fill"></i> Follow-up</span>' : statusBadge(e.status)) +
          '<span class="attention-row__note">' + escapeHtml(e.note) + '</span>' +
          '<i class="bi bi-chevron-right attention-row__chevron"></i>' +
        '</button>'
      ).join('') + '</div>'
    : '<p class="no-referral">No updates logged for this day.</p>';

  dayUpdatesModal.show();
}

calendarGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-day[data-date]');
  if (!cell) return;
  openDayUpdatesModal(cell.dataset.date);
});

dayUpdatesBody.addEventListener('click', (e) => {
  const row = e.target.closest('.attention-row');
  if (!row) return;
  dayUpdatesModal.hide();
  if (row.dataset.contactKey) {
    switchView('contacts');
    openContactUpdateModal(row.dataset.contactKey, row.dataset.contactName);
  } else {
    switchView('deals');
    openDetailModal(row.dataset.id);
  }
});

calPrevBtn.addEventListener('click', () => {
  calCurrentMonth = new Date(calCurrentMonth.getFullYear(), calCurrentMonth.getMonth() - 1, 1);
  renderCalendar();
});
calNextBtn.addEventListener('click', () => {
  calCurrentMonth = new Date(calCurrentMonth.getFullYear(), calCurrentMonth.getMonth() + 1, 1);
  renderCalendar();
});
calTodayBtn.addEventListener('click', () => {
  calCurrentMonth = firstOfMonth(new Date());
  renderCalendar();
});
