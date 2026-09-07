const db = require('../db');

/**
 * Vehicle tagging: a plain admin/editor-managed list, separate from Outfield
 * Designation's boards — a driver already placed in an RBS Fire Unit (say,
 * as its Driver) can also be tagged to a vehicle here without moving them
 * anywhere. A vehicle is identified by its license plate (not enforced
 * unique — data entry flexibility, not a real-world guarantee) plus an
 * optional vehicle type. A driver can only be tagged to one vehicle at a
 * time (tagging them elsewhere moves them); a vehicle commander has no such
 * restriction — they can command multiple vehicles, and a vehicle can have
 * multiple commanders.
 */
function findOrCreateVehicle(licensePlate, vehicleType) {
  const plate = String(licensePlate || '').trim();
  if (!plate) throw new Error('License plate is required.');

  let vehicle = db.prepare('SELECT id FROM vehicles WHERE license_plate = ? COLLATE NOCASE').get(plate);
  if (!vehicle) {
    const result = db.prepare('INSERT INTO vehicles (license_plate, vehicle_type) VALUES (?, ?)').run(plate, vehicleType || null);
    vehicle = { id: Number(result.lastInsertRowid) };
  } else if (vehicleType) {
    db.prepare('UPDATE vehicles SET vehicle_type = ? WHERE id = ?').run(vehicleType, vehicle.id);
  }
  return vehicle;
}

function listVehicleTags() {
  const vehicles = db.prepare('SELECT * FROM vehicles ORDER BY license_plate COLLATE NOCASE').all();

  const driverRows = db
    .prepare(
      `SELECT vd.vehicle_id, r.id AS roster_id, r.name, r.ref_id
       FROM vehicle_drivers vd JOIN roster r ON r.id = vd.roster_id
       ORDER BY r.name COLLATE NOCASE`
    )
    .all();
  const commanderRows = db
    .prepare(
      `SELECT vc.vehicle_id, r.id AS roster_id, r.name, r.ref_id
       FROM vehicle_commanders vc JOIN roster r ON r.id = vc.roster_id
       ORDER BY r.name COLLATE NOCASE`
    )
    .all();

  const driversByVehicle = new Map();
  for (const d of driverRows) {
    if (!driversByVehicle.has(d.vehicle_id)) driversByVehicle.set(d.vehicle_id, []);
    driversByVehicle.get(d.vehicle_id).push({ id: d.roster_id, name: d.name, ref_id: d.ref_id });
  }
  const commandersByVehicle = new Map();
  for (const c of commanderRows) {
    if (!commandersByVehicle.has(c.vehicle_id)) commandersByVehicle.set(c.vehicle_id, []);
    commandersByVehicle.get(c.vehicle_id).push({ id: c.roster_id, name: c.name, ref_id: c.ref_id });
  }

  return vehicles.map((v) => ({
    id: v.id,
    licensePlate: v.license_plate,
    vehicleType: v.vehicle_type,
    drivers: driversByVehicle.get(v.id) || [],
    commanders: commandersByVehicle.get(v.id) || [],
  }));
}

function addVehicleDriver(licensePlate, vehicleType, rosterId) {
  const person = db.prepare('SELECT id FROM roster WHERE id = ? AND active = 1').get(rosterId);
  if (!person) throw new Error('Unknown or inactive roster person.');

  const tx = db.transaction(() => {
    const vehicle = findOrCreateVehicle(licensePlate, vehicleType);
    // One driver, one vehicle — tagging them here moves them off any other.
    const previousVehicleIds = db
      .prepare('SELECT vehicle_id FROM vehicle_drivers WHERE roster_id = ? AND vehicle_id != ?')
      .all(rosterId, vehicle.id)
      .map((r) => r.vehicle_id);
    db.prepare('DELETE FROM vehicle_drivers WHERE roster_id = ? AND vehicle_id != ?').run(rosterId, vehicle.id);
    db.prepare('INSERT OR IGNORE INTO vehicle_drivers (vehicle_id, roster_id) VALUES (?, ?)').run(vehicle.id, rosterId);
    for (const oldVehicleId of previousVehicleIds) deleteVehicleIfEmpty(oldVehicleId);
  });
  tx();
}

function addVehicleCommander(licensePlate, vehicleType, rosterId) {
  const person = db.prepare('SELECT id FROM roster WHERE id = ? AND active = 1').get(rosterId);
  if (!person) throw new Error('Unknown or inactive roster person.');

  const tx = db.transaction(() => {
    const vehicle = findOrCreateVehicle(licensePlate, vehicleType);
    db.prepare('INSERT OR IGNORE INTO vehicle_commanders (vehicle_id, roster_id) VALUES (?, ?)').run(vehicle.id, rosterId);
  });
  tx();
}

function deleteVehicleIfEmpty(vehicleId) {
  const driverCount = db.prepare('SELECT COUNT(*) AS c FROM vehicle_drivers WHERE vehicle_id = ?').get(vehicleId).c;
  const commanderCount = db.prepare('SELECT COUNT(*) AS c FROM vehicle_commanders WHERE vehicle_id = ?').get(vehicleId).c;
  if (driverCount === 0 && commanderCount === 0) {
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
  }
}

function removeVehicleDriver(vehicleId, rosterId) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM vehicle_drivers WHERE vehicle_id = ? AND roster_id = ?').run(vehicleId, rosterId);
    deleteVehicleIfEmpty(vehicleId);
  });
  tx();
}

function removeVehicleCommander(vehicleId, rosterId) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM vehicle_commanders WHERE vehicle_id = ? AND roster_id = ?').run(vehicleId, rosterId);
    deleteVehicleIfEmpty(vehicleId);
  });
  tx();
}

function removeVehicle(vehicleId) {
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
}

module.exports = {
  listVehicleTags,
  addVehicleDriver,
  addVehicleCommander,
  removeVehicleDriver,
  removeVehicleCommander,
  removeVehicle,
};
