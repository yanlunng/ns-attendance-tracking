(function () {
  var personnel = window.SUMMARY_PERSONNEL || [];
  var initialCategory = window.SUMMARY_INITIAL_CATEGORY || null;

  var panel = document.getElementById('personnel-panel');
  var titleEl = document.getElementById('personnel-panel-title');
  var listEl = document.getElementById('personnel-list');
  var emptyEl = document.getElementById('personnel-empty');
  var closeBtn = document.getElementById('personnel-panel-close');
  var statsBox = document.getElementById('stats');
  var groupButtons = document.getElementById('group-filter-buttons');

  if (!panel || !statsBox) return; // weekend view has none of this

  var CATEGORY_LABELS = {
    reported: 'Reported',
    present: 'Present',
    offApproved: 'Off (approved)',
    offPending: 'Off (pending)',
    mc: 'MC',
    outproApproved: 'Outpro (approved)',
    outproPending: 'Outpro (pending)',
    conflicts: 'Conflicts',
  };

  var activeCategory = null;
  var activeGroup = 'ALL';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render() {
    statsBox.querySelectorAll('[data-category]').forEach(function (b) {
      b.classList.toggle('stat-active', b.getAttribute('data-category') === activeCategory);
    });

    if (!activeCategory) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';

    var matches = personnel.filter(function (p) {
      if (!p.categories[activeCategory]) return false;
      if (activeGroup !== 'ALL' && p.group !== activeGroup) return false;
      return true;
    });

    titleEl.textContent = CATEGORY_LABELS[activeCategory] + ' (' + matches.length + ')';

    listEl.innerHTML = matches
      .map(function (p) {
        return '<li>' + (p.rank ? escapeHtml(p.rank) + ' ' : '') + escapeHtml(p.name) + '</li>';
      })
      .join('');

    emptyEl.style.display = matches.length === 0 ? '' : 'none';
    listEl.style.display = matches.length === 0 ? 'none' : '';
  }

  statsBox.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-category]');
    if (!btn) return;
    var category = btn.getAttribute('data-category');
    activeCategory = activeCategory === category ? null : category;
    render();
    if (activeCategory) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  groupButtons.addEventListener('click', function (e) {
    var btn = e.target.closest('.group-filter-btn');
    if (!btn) return;
    activeGroup = btn.getAttribute('data-group');
    groupButtons.querySelectorAll('.group-filter-btn').forEach(function (b) {
      b.classList.toggle('is-active', b === btn);
    });
    render();
  });

  closeBtn.addEventListener('click', function () {
    activeCategory = null;
    render();
  });

  if (initialCategory) {
    activeCategory = initialCategory;
    render();
    panel.scrollIntoView({ block: 'start' });
  }
})();
