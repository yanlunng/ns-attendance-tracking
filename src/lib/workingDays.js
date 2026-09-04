const { getCountWeekends } = require('./settings');

function isWeekend(dateStr) {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6; // Sunday, Saturday
}

function isWorkingDay(dateStr) {
  return getCountWeekends() || !isWeekend(dateStr);
}

/** The next Monday on/after dateStr (same day if dateStr is already a Monday). */
function nextMonday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const daysUntilMonday = (8 - day) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return d.toISOString().slice(0, 10);
}

module.exports = { isWeekend, isWorkingDay, nextMonday };
