(function () {
  var roster = window.ROSTER || [];
  var exceptionIds = new Set(window.INITIAL_EXCEPTION_IDS || []);
  var rosterById = new Map(roster.map(function (p) { return [p.id, p]; }));

  var searchInput = document.getElementById('search-input');
  var resultsBox = document.getElementById('search-results');
  var exceptionsBody = document.getElementById('exceptions-body');
  var noExceptionsMsg = document.getElementById('no-exceptions-msg');
  var exceptionsTable = document.getElementById('exceptions-table');
  var hiddenInputsBox = document.getElementById('present-hidden-inputs');
  var presentCountHint = document.getElementById('present-count-hint');

  window.toggleOffDetail = function (statusSelect) {
    var row = statusSelect.closest('tr');
    var offDetail = row && row.querySelector('.off-detail');
    if (!offDetail) return;
    offDetail.style.display = statusSelect.value === 'off' ? '' : 'none';
  };

  window.toggleOffTime = function (periodSelect) {
    var offDetail = periodSelect.closest('.off-detail');
    if (!offDetail) return;
    var display = periodSelect.value === 'TIME' ? '' : 'none';
    offDetail.querySelectorAll('input[type=time]').forEach(function (input) {
      input.style.display = display;
    });
  };

  function updatePresentCount() {
    var presentCount = window.TOTAL_PEOPLE - exceptionIds.size;
    presentCountHint.textContent = presentCount + ' of ' + window.TOTAL_PEOPLE + ' default to Present and need no action.';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clearResults() {
    resultsBox.innerHTML = '';
    resultsBox.style.display = 'none';
  }

  function renderResults(matches) {
    if (matches.length === 0) {
      clearResults();
      return;
    }
    resultsBox.innerHTML = matches
      .map(function (p) {
        return (
          '<div class="search-result" data-id="' + p.id + '">' +
          '<span class="sr-name">' + escapeHtml(p.name) + '</span>' +
          (p.ref_id ? '<span class="sr-meta">' + escapeHtml(p.ref_id) + '</span>' : '') +
          '</div>'
        );
      })
      .join('');
    resultsBox.style.display = 'block';
  }

  function addException(id) {
    if (exceptionIds.has(id)) return;
    var person = rosterById.get(id);
    if (!person) return;

    var hiddenInput = document.getElementById('present-input-' + id);
    if (hiddenInput) hiddenInput.remove();

    var row = document.createElement('tr');
    row.setAttribute('data-id', id);
    row.innerHTML =
      '<td data-label="Name">' + escapeHtml(person.name) + '</td>' +
      '<td data-label="Rank">' + escapeHtml(person.ref_id || '') + '</td>' +
      '<td data-label="Status">' +
        '<select name="status_' + id + '" onchange="window.toggleOffDetail(this)">' +
          '<option value="off">Off</option>' +
          '<option value="mc">MC</option>' +
          (window.CAN_MARK_OUTPRO ? '<option value="outpro">1st Day Outpro</option>' : '') +
        '</select>' +
      '</td>' +
      '<td data-label="Off period" class="off-detail">' +
        '<select name="off_period_' + id + '" onchange="window.toggleOffTime(this)">' +
          '<option value="AM">AM</option>' +
          '<option value="PM">PM</option>' +
          '<option value="TIME">Custom time</option>' +
        '</select>' +
        '<input type="time" name="off_time_' + id + '" style="display:none" class="off-time-start" />' +
        '<input type="time" name="off_time_end_' + id + '" style="display:none" class="off-time-end" />' +
      '</td>' +
      '<td data-label="Reason"><input type="text" name="remarks_' + id + '" placeholder="reason (optional)" /></td>' +
      '<td><button type="button" class="link-btn remove-exception" data-id="' + id + '">Remove</button></td>';
    exceptionsBody.appendChild(row);

    exceptionIds.add(id);
    noExceptionsMsg.style.display = 'none';
    exceptionsTable.style.display = '';
    updatePresentCount();

    var remarksInput = row.querySelector('input[type=text]');
    if (remarksInput) remarksInput.focus();
  }

  function removeException(id) {
    var row = exceptionsBody.querySelector('tr[data-id="' + id + '"]');
    if (row) row.remove();
    exceptionIds.delete(id);

    var person = rosterById.get(id);
    if (person) {
      var hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'status_' + id;
      hidden.value = 'present';
      hidden.id = 'present-input-' + id;
      hiddenInputsBox.appendChild(hidden);
    }

    if (exceptionIds.size === 0) {
      noExceptionsMsg.style.display = '';
      exceptionsTable.style.display = 'none';
    }
    updatePresentCount();
  }

  searchInput.addEventListener('input', function () {
    var q = searchInput.value.trim().toLowerCase();
    if (!q) {
      clearResults();
      return;
    }
    var matches = roster
      .filter(function (p) { return !exceptionIds.has(p.id) && p.name.toLowerCase().indexOf(q) !== -1; })
      .slice(0, 8);
    renderResults(matches);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') clearResults();
    if (e.key === 'Enter') {
      e.preventDefault();
      var first = resultsBox.querySelector('.search-result');
      if (first) {
        addException(Number(first.getAttribute('data-id')));
        searchInput.value = '';
        clearResults();
      }
    }
  });

  resultsBox.addEventListener('mousedown', function (e) {
    var el = e.target.closest('.search-result');
    if (!el) return;
    addException(Number(el.getAttribute('data-id')));
    searchInput.value = '';
    clearResults();
    searchInput.focus();
  });

  document.addEventListener('click', function (e) {
    if (e.target === searchInput) return;
    if (!resultsBox.contains(e.target)) clearResults();
  });

  exceptionsBody.addEventListener('click', function (e) {
    var btn = e.target.closest('.remove-exception');
    if (!btn) return;
    removeException(Number(btn.getAttribute('data-id')));
  });
})();
