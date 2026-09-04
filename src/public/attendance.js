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
        var meta = [p.ref_id, p.unit].filter(Boolean).join(' · ');
        return (
          '<div class="search-result" data-id="' + p.id + '">' +
          '<span class="sr-name">' + escapeHtml(p.name) + '</span>' +
          (meta ? '<span class="sr-meta">' + escapeHtml(meta) + '</span>' : '') +
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
      '<td>' + escapeHtml(person.name) + '</td>' +
      '<td>' + escapeHtml(person.ref_id || '') + '</td>' +
      '<td>' + escapeHtml(person.unit || '') + '</td>' +
      '<td><select name="status_' + id + '"><option value="off">Off</option><option value="leave">Leave</option></select></td>' +
      '<td><input type="text" name="remarks_' + id + '" placeholder="reason (optional)" /></td>' +
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
