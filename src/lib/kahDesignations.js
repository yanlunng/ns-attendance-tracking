const db = require('../db');

function listKahDesignations() {
  return db
    .prepare(
      `SELECT kd.id, kd.role_text, kd.sort_order, r.id AS roster_id, r.name, r.ref_id
       FROM kah_designations kd
       JOIN roster r ON r.id = kd.roster_id
       ORDER BY kd.sort_order, kd.id`
    )
    .all();
}

function addKahDesignation(rosterId, roleText) {
  const person = db.prepare('SELECT id FROM roster WHERE id = ? AND active = 1').get(rosterId);
  if (!person) throw new Error('Unknown or inactive roster person.');

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM kah_designations').get().m;
  db.prepare('INSERT INTO kah_designations (roster_id, role_text, sort_order) VALUES (?, ?, ?)').run(
    rosterId,
    roleText,
    maxOrder + 1
  );
}

function removeKahDesignation(id) {
  db.prepare('DELETE FROM kah_designations WHERE id = ?').run(id);
}

module.exports = { listKahDesignations, addKahDesignation, removeKahDesignation };
