const db = require('../db');

/**
 * Equipment serial numbers recorded per Fire Unit/Team section — the
 * Equipment tab on Outfield Designation, separate from the crew/slot board
 * but keyed to the same outfield_sections rows.
 */
function listEquipmentForSection(sectionId) {
  return db.prepare('SELECT * FROM outfield_equipment WHERE section_id = ? ORDER BY sort_order, id').all(sectionId);
}

function addEquipmentItem(sectionId, itemName, serialNumber) {
  const name = (itemName || '').trim();
  const serial = (serialNumber || '').trim();
  if (!name || !serial) throw new Error('Item name and serial number are required.');

  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM outfield_equipment WHERE section_id = ?')
    .get(sectionId).m;
  db.prepare(
    'INSERT INTO outfield_equipment (section_id, item_name, serial_number, sort_order) VALUES (?, ?, ?, ?)'
  ).run(sectionId, name, serial, maxOrder + 1);
}

function removeEquipmentItem(id) {
  db.prepare('DELETE FROM outfield_equipment WHERE id = ?').run(id);
}

/**
 * Replaces the target section's equipment list with a copy of the source's —
 * e.g. Fire Unit 1 copying Fire Unit 4's list since they're issued the same
 * gear. Existing target rows are cleared first so repeat copies don't
 * duplicate; each copied row is independent afterward, so removing one (the
 * "x", for whatever few items genuinely differ for that unit) never touches
 * the source.
 */
function copyEquipment(fromSectionId, toSectionId) {
  if (fromSectionId === toSectionId) return;
  const sourceItems = listEquipmentForSection(fromSectionId);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM outfield_equipment WHERE section_id = ?').run(toSectionId);
    const insert = db.prepare(
      'INSERT INTO outfield_equipment (section_id, item_name, serial_number, sort_order) VALUES (?, ?, ?, ?)'
    );
    sourceItems.forEach((item, i) => insert.run(toSectionId, item.item_name, item.serial_number, i));
  });
  tx();
}

module.exports = { listEquipmentForSection, addEquipmentItem, removeEquipmentItem, copyEquipment };
