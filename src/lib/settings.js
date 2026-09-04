const db = require('../db');

const DEFAULTS = {
  count_weekends: '0',
  cycle_start_date: '',
  cycle_end_date: '',
  mainbody_phase_start_date: '',
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key] ?? null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function getCountWeekends() {
  return getSetting('count_weekends') === '1';
}

function getCycleRange() {
  const start = getSetting('cycle_start_date');
  const end = getSetting('cycle_end_date');
  return { start: start || null, end: end || null };
}

module.exports = { getSetting, setSetting, getCountWeekends, getCycleRange };
