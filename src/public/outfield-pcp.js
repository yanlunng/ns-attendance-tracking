(function () {
  var searchInput = document.getElementById('pcp-search-input');
  if (!searchInput) return;

  var roster = window.PCP_SOURCE_ROSTER || [];
  var resultsBox = document.getElementById('pcp-search-results');
  var hiddenId = document.getElementById('pcp-selected-roster-id');
  var form = document.getElementById('pcp-add-form');

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

  searchInput.addEventListener('input', function () {
    hiddenId.value = '';
    var q = searchInput.value.trim().toLowerCase();
    if (!q) {
      clearResults();
      return;
    }
    var matches = roster.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
    renderResults(matches);
  });

  resultsBox.addEventListener('mousedown', function (e) {
    var el = e.target.closest('.search-result');
    if (!el) return;
    var id = Number(el.getAttribute('data-id'));
    var person = roster.filter(function (p) { return p.id === id; })[0];
    hiddenId.value = id;
    searchInput.value = person ? person.name : '';
    clearResults();
  });

  document.addEventListener('click', function (e) {
    if (e.target === searchInput) return;
    if (!resultsBox.contains(e.target)) clearResults();
  });

  form.addEventListener('submit', function (e) {
    if (!hiddenId.value) {
      e.preventDefault();
      alert('Pick a person from the search results first.');
    }
  });
})();
