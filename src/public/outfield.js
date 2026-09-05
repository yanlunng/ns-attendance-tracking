(function () {
  var board = document.querySelector('.outfield-board');
  if (!board) return;

  var dragEl = null;
  var ghost = null;
  var startX = 0;
  var startY = 0;
  var dragging = false;
  var DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag, not a tap

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

  document.addEventListener('pointerdown', function (e) {
    var card = e.target.closest('.outfield-card[data-draggable="1"]');
    if (!card) return;
    dragEl = card;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    e.preventDefault();
  });

  document.addEventListener('pointermove', function (e) {
    if (!dragEl) return;
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
    if (!dragEl) return;
    if (dragging) {
      var zone = findDropzone(e.clientX, e.clientY);
      clearHighlights();
      if (ghost) ghost.remove();
      dragEl.classList.remove('outfield-card-dragging');

      if (zone) {
        var personId = dragEl.getAttribute('data-person-id');
        var sectionId = zone.getAttribute('data-section-id');
        var slot = zone.getAttribute('data-slot') || '';
        fetch('/outfield/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'personId=' + encodeURIComponent(personId) +
            '&sectionId=' + encodeURIComponent(sectionId) + '&slot=' + encodeURIComponent(slot),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.ok) window.location.reload();
            else alert(res.error || 'Could not move that person.');
          })
          .catch(function () { alert('Network error — could not save that move.'); });
      }
    }
    dragEl = null;
    ghost = null;
    dragging = false;
  });

  document.addEventListener('pointercancel', function () {
    if (ghost) ghost.remove();
    if (dragEl) dragEl.classList.remove('outfield-card-dragging');
    clearHighlights();
    dragEl = null;
    ghost = null;
    dragging = false;
  });
})();
