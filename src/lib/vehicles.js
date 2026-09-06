const db = require('../db');

/**
 * Vehicle tagging: a plain admin/editor-managed list, separate from Outfield
 * Designation's boards — a driver already placed in an RBS Fire Unit (say,
 * as its Driver) can also be tagged to a vehicle here without moving them
 * anywhere. One vehicle can have multiple drivers; deleting a vehicle's last
 * driver deletes the vehicle itself (no empty vehicles hang around).
 */
function listVehicleTags() {
  const rows = db
    .prepare(
      `SELECT v.id AS vehicle_id, v.name AS vehicle_name, r.id AS roster_id, r.name, r.ref_id
       FROM vehicles v
       LEFT JOIN vehicle_drivers vd ON vd.vehicle_id = v.id
       LEFT JOIN roster r ON r.id = vd.roster_id
       ORDER BY v.name COLLATE NOCASE, r.name COLLATE NOCASE`
    )
    .all();

  const byVehicle = new Map();
  for (const row of rows) {
    if (!byVehicle.has(row.vehicle_id)) {
      byVehicle.set(row.vehicle_id, { id: row.vehicle_id, name: row.vehicle_name, drivers: [] });
    }
    if (row.roster_id) {
      byVehicle.get(row.vehicle_id).drivers.push({ id: row.roster_id, name: row.name, ref_id: row.ref_id });
    }
  }
  return [...byVehicle.values()];
}

function addVehicleDriver(vehicleName, rosterId) {
  const name = String(vehicleName || '').trim();
  if (!name) throw new Error('Vehicle name is required.');

  const person = db.prepare('SELECT id FROM roster WHERE id = ? AND active = 1').get(rosterId);
  if (!person) throw new Error('Unknown or inactive roster person.');

  const tx = db.transaction(() => {
    let vehicle = db.prepare('SELECT id FROM vehicles WHERE name = ? COLLATE NOCASE').get(name);
    if (!vehicle) {
      const result = db.prepare('INSERT INTO vehicles (name) VALUES (?)').run(name);
      vehicle = { id: Number(result.lastInsertRowid) };
    }
    db.prepare('INSERT OR IGNORE INTO vehicle_drivers (vehicle_id, roster_id) VALUES (?, ?)').run(vehicle.id, rosterId);
  });
  tx();
}

function removeVehicleDriver(vehicleId, rosterId) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM vehicle_drivers WHERE vehicle_id = ? AND roster_id = ?').run(vehicleId, rosterId);
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM vehicle_drivers WHERE vehicle_id = ?').get(vehicleId).c;
    if (remaining === 0) db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
  });
  tx();
}

function removeVehicle(vehicleId) {
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
}

module.exports = { listVehicleTags, addVehicleDriver, removeVehicleDriver, removeVehicle };
