(function () {
  var board = document.querySelector('.outfield-board');
  if (!board) return;

  var dragEl = null; // set only when the press started on a card
  var pressZone = null; // set when the press started on an empty dropzone (no card)
  var ghost = null;
  var startX = 0;
  var startY = 0;
  var dragging = false;
  var DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag, not a tap

  var selectedCardEl = null;
  var selectedHint = document.getElementById('outfield-selected-hint');

  function makeGhost(card) {
    var rect = card.getBoundingClientRect();
    var g = card.cloneNode(true);
    g.classList.add('outfield-ghost');
    g.style.width = rect.width + 'px';
    g.style.left = rect.left + 'px';
    g.style.top = rect.top + 'px';
    document.body.appendChild(g);
    return g;
  }

  function findDropzone(x, y) {
    var el = document.elementFromPoint(x, y);
    return el ? el.closest('.outfield-dropzone') : null;
  }

  function clearHighlights() {
    document.querySelectorAll('.outfield-dropzone-over').forEach(function (el) {
      el.classList.remove('outfield-dropzone-over');
    });
  }

  function updateSelectedHint() {
    if (!selectedHint) return;
    if (selectedCardEl) {
      selectedHint.style.display = '';
      selectedHint.textContent =
        'Selected: ' + (selectedCardEl.getAttribute('data-search-name') || '') +
        ' — click a slot or pool to place them, or click them again to cancel.';
    } else {
      selectedHint.style.display = 'none';
    }
  }

  function selectCard(cardEl) {
    var wasSameCard = selectedCardEl === cardEl;
    if (selectedCardEl) selectedCardEl.classList.remove('outfield-card-selected');
    if (wasSameCard) {
      selectedCardEl = null;
    } else {
      selectedCardEl = cardEl;
      selectedCardEl.classList.add('outfield-card-selected');
    }
    updateSelectedHint();
  }

  function clearSelection() {
    if (selectedCardEl) selectedCardEl.classList.remove('outfield-card-selected');
    selectedCardEl = null;
    updateSelectedHint();
  }

  function performAssign(personId, sectionId, slot) {
    return fetch('/outfield/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'personId=' + encodeURIComponent(personId) +
        '&sectionId=' + encodeURIComponent(sectionId) + '&slot=' + encodeURIComponent(slot || ''),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) window.location.reload();
        else alert(res.error || 'Could not move that person.');
      })
      .catch(function () { alert('Network error — could not save that move.'); });
  }

  document.addEventListener('pointerdown', function (e) {
    var card = e.target.closest('.outfield-card[data-draggable="1"]');
    var zone = !card ? e.target.closest('.outfield-dropzone') : null;
    if (!card && !zone) return;

    dragEl = card;
    pressZone = zone;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    e.preventDefault();
  });

  document.addEventListener('pointermove', function (e) {
    if (!dragEl) return; // only cards support drag-move; a press on an empty zone just waits for pointerup
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragging = true;
      ghost = makeGhost(dragEl);
      dragEl.classList.add('outfield-card-dragging');
    }

    ghost.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    clearHighlights();
    var zone = findDropzone(e.clientX, e.clientY);
    if (zone) zone.classList.add('outfield-dropzone-over');
  });

  document.addEventListener('pointerup', function (e) {
    if (!dragEl && !pressZone) return;

    if (dragging) {
      var zone = findDropzone(e.clientX, e.clientY);
      clearHighlights();
      if (ghost) ghost.remove();
      dragEl.classList.remove('outfield-card-dragging');

      if (zone) {
        var personId = dragEl.getAttribute('data-person-id');
        var sectionId = zone.getAttribute('data-section-id');
        var slot = zone.getAttribute('data-slot') || '';
        performAssign(personId, sectionId, slot);
      }
    } else if (dragEl) {
      // Plain click (no movement) on a card — pick it up/put it down, mirroring drag-and-drop.
      selectCard(dragEl);
    } else if (pressZone && selectedCardEl) {
      // Plain click on an empty dropzone while someone is selected — place them here.
      var placedId = selectedCardEl.getAttribute('data-person-id');
      var placedSectionId = pressZone.getAttribute('data-section-id');
      var placedSlot = pressZone.getAttribute('data-slot') || '';
      clearSelection();
      performAssign(placedId, placedSectionId, placedSlot);
    }

    dragEl = null;
    pressZone = null;
    ghost = null;
    dragging = false;
  });

  document.addEventListener('pointercancel', function () {
    if (ghost) ghost.remove();
    if (dragEl) dragEl.classList.remove('outfield-card-dragging');
    clearHighlights();
    dragEl = null;
    pressZone = null;
    ghost = null;
    dragging = false;
  });

  // --- Type-a-name alternative to dragging ---
  var searchInput = document.getElementById('outfield-search-input');
  var resultsBox = document.getElementById('outfield-search-results');
  if (searchInput && resultsBox) {
    var cardIndex = Array.prototype.slice.call(document.querySelectorAll('.outfield-card[data-draggable="1"]')).map(
      function (el) {
        return { id: el.getAttribute('data-person-id'), name: el.getAttribute('data-search-name') || '', el: el };
      }
    );

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
          return '<div class="search-result" data-id="' + p.id + '"><span class="sr-name">' + escapeHtml(p.name) + '</span></div>';
        })
        .join('');
      resultsBox.style.display = 'block';
    }

    searchInput.addEventListener('input', function () {
      var q = searchInput.value.trim().toLowerCase();
      if (!q) {
        clearResults();
        return;
      }
      var matches = cardIndex.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
      renderResults(matches);
    });

    resultsBox.addEventListener('mousedown', function (e) {
      var el = e.target.closest('.search-result');
      if (!el) return;
      var id = el.getAttribute('data-id');
      var entry = cardIndex.filter(function (p) { return p.id === id; })[0];
      if (entry) selectCard(entry.el);
      searchInput.value = '';
      clearResults();
    });

    document.addEventListener('click', function (e) {
      if (e.target === searchInput) return;
      if (!resultsBox.contains(e.target)) clearResults();
    });
  }
})();
