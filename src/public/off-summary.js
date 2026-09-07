(function () {
  var tbody = document.getElementById('off-summary-body');
  if (!tbody) return; // nobody's off this cycle — nothing to filter

  var data = window.OFF_SUMMARY || [];
  var addInput = document.getElementById('off-date-add');
  var addBtn = document.getElementById('off-date-add-btn');
  var clearBtn = document.getElementById('off-date-clear');
  var chipsBox = document.getElementById('off-date-chips');
  var emptyEl = document.getElementById('off-summary-empty');
  var table = document.getElementById('off-summary-table');

  var selected = [];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderChips() {
    chipsBox.innerHTML = selected
      .map(function (d) {
        return (
          '<span class="badge badge-off off-date-chip">' + escapeHtml(d) +
          ' <button type="button" class="chip-remove" data-date="' + escapeHtml(d) + '">&times;</button></span>'
        );
      })
      .join('');
  }

  function render() {
    var rows = data
      .map(function (p) {
        var matchDates = selected.length === 0 ? p.dates : p.dates.filter(function (d) { return selected.indexOf(d.date) !== -1; });
        return { p: p, matchDates: matchDates };
      })
      .filter(function (r) { return r.matchDates.length > 0; });

    tbody.innerHTML = rows
      .map(function (r) {
        var datesText = r.matchDates
          .map(function (d) { return d.date + ' (' + d.period + (d.status === 'pending' ? ', pending' : '') + ')'; })
          .join(', ');
        return (
          '<tr><td data-label="Name">' + escapeHtml(r.p.name) + '</td>' +
          '<td data-label="Rank">' + escapeHtml(r.p.rank) + '</td>' +
          '<td data-label="Group">' + escapeHtml(r.p.group || '—') + '</td>' +
          '<td data-label="Off dates">' + escapeHtml(datesText) + '</td></tr>'
        );
      })
      .join('');

    table.style.display = rows.length === 0 ? 'none' : '';
    emptyEl.style.display = rows.length === 0 ? '' : 'none';
  }

  addBtn.addEventListener('click', function () {
    var date = addInput.value;
    if (!date || selected.indexOf(date) !== -1) return;
    selected.push(date);
    selected.sort();
    addInput.value = '';
    renderChips();
    render();
  });

  chipsBox.addEventListener('click', function (e) {
    var btn = e.target.closest('.chip-remove');
    if (!btn) return;
    var date = btn.getAttribute('data-date');
    selected = selected.filter(function (d) { return d !== date; });
    renderChips();
    render();
  });

  clearBtn.addEventListener('click', function () {
    selected = [];
    renderChips();
    render();
  });

  render();
})();
