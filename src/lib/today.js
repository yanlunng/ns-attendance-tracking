// The app's "today" must always mean today in Singapore, regardless of what
// timezone the server process itself happens to be running in — the
// Dockerfile never sets TZ, so the container defaults to UTC, and relying on
// the server's own offset (e.g. via Date.getTimezoneOffset()) silently makes
// "today" lag a full calendar day behind Singapore from midnight until 8am
// SGT every day. Singapore doesn't observe DST, so a fixed +8h shift is
// correct year-round — no timezone database lookup needed.
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

function todayStr() {
  return new Date(Date.now() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

module.exports = { todayStr };
