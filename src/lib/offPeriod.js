/** Renders an off_period (AM/PM/TIME/FULL) for display, expanding TIME into its start-end range. */
function formatOffPeriod(offPeriod, offTime, offTimeEnd) {
  if (offPeriod === 'TIME') return `${offTime}–${offTimeEnd}`;
  if (offPeriod === 'FULL') return 'Full day';
  return offPeriod;
}

module.exports = { formatOffPeriod };
