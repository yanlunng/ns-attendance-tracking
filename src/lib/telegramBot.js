const crypto = require('crypto');
const db = require('../db');
const telegramApi = require('./telegramApi');
const { submitOne, OFF_PERIODS } = require('./attendanceSubmit');
const { activeRosterForDate } = require('./roster');
const { getCycleRange } = require('./settings');

function todayStr() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

function tomorrowStr() {
  const d = new Date(`${todayStr()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function getSession(chatId) {
  const row = db.prepare('SELECT * FROM telegram_sessions WHERE chat_id = ?').get(chatId);
  if (!row) return { state: 'idle', data: {} };
  return { state: row.state, data: JSON.parse(row.data) };
}

function setSession(chatId, state, data) {
  db.prepare(
    `INSERT INTO telegram_sessions (chat_id, state, data, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = datetime('now')`
  ).run(chatId, state, JSON.stringify(data));
}

function clearSession(chatId) {
  db.prepare('DELETE FROM telegram_sessions WHERE chat_id = ?').run(chatId);
}

function getLinkedUser(chatId) {
  return db
    .prepare(
      `SELECT u.* FROM users u
       JOIN telegram_links l ON l.user_id = u.id
       WHERE l.chat_id = ?`
    )
    .get(chatId);
}

function linkCapFor(username) {
  return db.telegramLinkCapFor(username);
}

function countLinks(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM telegram_links WHERE user_id = ?').get(userId).c;
}

const STATUS_LABELS = { present: 'Present', off: 'Off', mc: 'MC', outpro: '1st Day Outpro' };

/** Generates and stores a fresh one-time linking code for a user, replacing any previous one. */
function generateLinkCode(userId) {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('UPDATE users SET telegram_link_code = ? WHERE id = ?').run(code, userId);
  return code;
}

async function handleUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  if (update.message) return handleMessage(update.message);
}

async function startCmd(chatId) {
  return telegramApi.sendMessage(
    chatId,
    "Hi! To use this bot, link it to your attendance account first:\n\n" +
      '1. Log into the web app.\n' +
      '2. Go to "Change password" / My Account.\n' +
      '3. Copy the linking code shown there.\n' +
      '4. Send me: /link CODE\n\n' +
      'Once linked, send /mark to record attendance.'
  );
}

async function whoamiCmd(chatId) {
  const user = getLinkedUser(chatId);
  if (!user) return telegramApi.sendMessage(chatId, "You're not linked to any account yet. Send /link CODE.");
  return telegramApi.sendMessage(chatId, `Linked as <b>${user.username}</b> (${user.role}).`);
}

async function linkCmd(chatId, text, telegramUserId) {
  const code = text.replace('/link', '').trim().toUpperCase();
  if (!code) return telegramApi.sendMessage(chatId, 'Usage: /link CODE — get your code from "My Account" in the web app.');

  const user = db.prepare('SELECT * FROM users WHERE telegram_link_code = ?').get(code);
  if (!user) return telegramApi.sendMessage(chatId, "That code isn't valid — it may have expired. Generate a new one from My Account.");

  const alreadyLinkedElsewhere = db.prepare('SELECT user_id FROM telegram_links WHERE chat_id = ?').get(telegramUserId);
  if (alreadyLinkedElsewhere && alreadyLinkedElsewhere.user_id !== user.id) {
    db.prepare('DELETE FROM telegram_links WHERE chat_id = ?').run(telegramUserId);
  }

  const cap = linkCapFor(user.username);
  const isKah = db.isKahUsername(user.username);
  if (!isKah) {
    // Regular accounts stay 1:1 — a fresh link replaces any previous one.
    db.prepare('DELETE FROM telegram_links WHERE user_id = ?').run(user.id);
  } else if (countLinks(user.id) >= cap) {
    return telegramApi.sendMessage(
      chatId,
      `<b>${user.username}</b> already has ${cap} Telegram accounts linked (the max). Ask one to /unlink first.`
    );
  }

  db.prepare('INSERT INTO telegram_links (user_id, chat_id) VALUES (?, ?)').run(user.id, telegramUserId);
  db.prepare('UPDATE users SET telegram_link_code = NULL WHERE id = ?').run(user.id);
  return telegramApi.sendMessage(chatId, `Linked as <b>${user.username}</b>. Send /mark to record attendance.`);
}

async function unlinkCmd(chatId) {
  const user = getLinkedUser(chatId);
  if (!user) return telegramApi.sendMessage(chatId, "This chat isn't linked to anything.");
  db.prepare('DELETE FROM telegram_links WHERE chat_id = ?').run(chatId);
  return telegramApi.sendMessage(chatId, `Unlinked from <b>${user.username}</b>.`);
}

async function markCmd(chatId) {
  const user = getLinkedUser(chatId);
  if (!user) return telegramApi.sendMessage(chatId, "You're not linked yet. Send /link CODE from your account page first.");

  setSession(chatId, 'awaiting_date', {});
  const cycle = getCycleRange();
  const hint = cycle.start && cycle.end ? `\n(Cycle runs ${cycle.start} to ${cycle.end}.)` : '';
  return telegramApi.sendMessage(chatId, `Which date?${hint}`, {
    ...telegramApi.inlineKeyboard([
      [
        { text: 'Today', data: 'date:today' },
        { text: 'Tomorrow', data: 'date:tomorrow' },
      ],
    ]),
  });
}

function dateFromToken(token) {
  if (token === 'today') return todayStr();
  if (token === 'tomorrow') return tomorrowStr();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : null;
}

async function proceedAfterDate(chatId, user, date) {
  if (user.role === 'self') {
    if (!user.roster_id) {
      clearSession(chatId);
      return telegramApi.sendMessage(chatId, "Your account isn't linked to a roster record — ask an admin to check it.");
    }
    setSession(chatId, 'awaiting_status', { date, rosterId: user.roster_id, personName: user.username });
    return askStatus(chatId, user, date, user.username);
  }

  setSession(chatId, 'awaiting_person_query', { date });
  return telegramApi.sendMessage(chatId, `Date set to ${date}. Now type the name of the person to mark.`);
}

async function handleDateInput(chatId, user, session, text) {
  const date = dateFromToken(text.trim());
  if (!date) return telegramApi.sendMessage(chatId, 'Please send a date as YYYY-MM-DD, or use the buttons above.');
  return proceedAfterDate(chatId, user, date);
}

async function handlePersonQuery(chatId, user, session, text) {
  const query = text.trim().toLowerCase();
  if (!query) return telegramApi.sendMessage(chatId, 'Type at least part of a name.');

  const roster = activeRosterForDate(session.data.date);
  const matches = roster.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 8);
  if (matches.length === 0) {
    return telegramApi.sendMessage(chatId, 'No one matching that name is eligible for that date. Try another name, or /cancel.');
  }

  setSession(chatId, 'awaiting_person_pick', { ...session.data });
  return telegramApi.sendMessage(
    chatId,
    'Who do you mean?',
    telegramApi.inlineKeyboard(matches.map((p) => [{ text: `${p.ref_id || ''} ${p.name}`.trim(), data: `person:${p.id}` }]))
  );
}

async function askStatus(chatId, user, date, personName) {
  const buttons = [
    [
      { text: 'Present', data: 'status:present' },
      { text: 'Off', data: 'status:off' },
    ],
    [{ text: 'MC', data: 'status:mc' }],
  ];
  if (['admin', 'editor'].includes(user.role)) buttons.push([{ text: '1st Day Outpro', data: 'status:outpro' }]);
  return telegramApi.sendMessage(chatId, `Marking <b>${personName}</b> for ${date}. What status?`, telegramApi.inlineKeyboard(buttons));
}

function normalizeTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

async function handleOffTimeInput(chatId, user, session, text) {
  const start = normalizeTime(text);
  if (!start) return telegramApi.sendMessage(chatId, 'Send a time like 14:30.');
  setSession(chatId, 'awaiting_off_time_end', { ...session.data, offTime: start });
  return telegramApi.sendMessage(chatId, 'And what time does it end?');
}

async function handleOffTimeEndInput(chatId, user, session, text) {
  const end = normalizeTime(text);
  if (!end) return telegramApi.sendMessage(chatId, 'Send a time like 16:00.');
  if (end <= session.data.offTime) {
    return telegramApi.sendMessage(chatId, `That's not after ${session.data.offTime} — send an end time later than the start.`);
  }
  return finalizeSubmission(chatId, user, { ...session.data, offTimeEnd: end });
}

async function handleMcDetail(chatId, user, session, text, photo) {
  if (photo && photo.length > 0) {
    // Telegram sends multiple resolutions; the last is the largest.
    return finalizeSubmission(chatId, user, { ...session.data, pendingPhotoFileId: photo[photo.length - 1].file_id });
  }
  const remarks = text.trim();
  if (remarks.toLowerCase() === 'skip') return finalizeSubmission(chatId, user, session.data);
  return finalizeSubmission(chatId, user, { ...session.data, remarks });
}

async function finalizeSubmission(chatId, user, data) {
  const result = submitOne({
    date: data.date,
    rosterId: data.rosterId,
    submitterId: user.id,
    submitterRole: user.role,
    status: data.status,
    offPeriod: data.offPeriod,
    offTime: data.offTime,
    offTimeEnd: data.offTimeEnd,
    remarks: data.remarks,
  });

  if (!result.ok) {
    clearSession(chatId);
    return telegramApi.sendMessage(chatId, `Couldn't save that: ${result.error}`);
  }

  if (data.pendingPhotoFileId) {
    await attachMcPhoto(data.date, data.rosterId, user.id, data.pendingPhotoFileId);
  }

  clearSession(chatId);
  const statusLine =
    data.status === 'off'
      ? `Off (${data.offPeriod === 'TIME' ? `${data.offTime}–${data.offTimeEnd}` : data.offPeriod}) — ${result.approvalStatus}`
      : `${STATUS_LABELS[data.status]}${result.approvalStatus === 'pending' ? ' — pending approval' : ''}`;
  return telegramApi.sendMessage(chatId, `Saved: <b>${data.personName}</b>, ${data.date} — ${statusLine}.`);
}

async function attachMcPhoto(date, rosterId, submitterId, fileId) {
  const path = require('path');
  const fs = require('fs');
  const submission = db
    .prepare('SELECT * FROM attendance_submissions WHERE date = ? AND roster_id = ? AND user_id = ?')
    .get(date, rosterId, submitterId);
  if (!submission) return;

  const attachmentsDir = path.join(__dirname, '..', '..', 'data', 'attachments');
  if (!fs.existsSync(attachmentsDir)) fs.mkdirSync(attachmentsDir, { recursive: true });
  const destPath = path.join(attachmentsDir, `${submission.id}-${Date.now()}.jpg`);
  await telegramApi.downloadFile(fileId, destPath);
  db.prepare('UPDATE attendance_submissions SET attachment_path = ? WHERE id = ?').run(destPath, submission.id);
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  if (text.startsWith('/start')) return startCmd(chatId);
  if (text.startsWith('/link')) return linkCmd(chatId, text, message.from.id);
  if (text.startsWith('/unlink')) return unlinkCmd(chatId);
  if (text.startsWith('/cancel')) {
    clearSession(chatId);
    return telegramApi.sendMessage(chatId, 'Cancelled.');
  }
  if (text.startsWith('/mark')) return markCmd(chatId);
  if (text.startsWith('/whoami')) return whoamiCmd(chatId);

  const user = getLinkedUser(chatId);
  if (!user) return telegramApi.sendMessage(chatId, "You're not linked yet. Send /link CODE from your account page first.");

  const session = getSession(chatId);
  switch (session.state) {
    case 'awaiting_date':
      return handleDateInput(chatId, user, session, text);
    case 'awaiting_person_query':
      return handlePersonQuery(chatId, user, session, text);
    case 'awaiting_off_time':
      return handleOffTimeInput(chatId, user, session, text);
    case 'awaiting_off_time_end':
      return handleOffTimeEndInput(chatId, user, session, text);
    case 'awaiting_mc_detail':
      return handleMcDetail(chatId, user, session, text, message.photo);
    default:
      return telegramApi.sendMessage(chatId, 'Send /mark to start marking attendance.');
  }
}

async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data || '';
  await telegramApi.answerCallbackQuery(callbackQuery.id);

  const user = getLinkedUser(chatId);
  if (!user) return telegramApi.sendMessage(chatId, "You're not linked yet. Send /link CODE from your account page first.");

  const session = getSession(chatId);
  const [kind, value] = data.split(':');

  if (kind === 'date' && session.state === 'awaiting_date') {
    const date = dateFromToken(value);
    if (!date) return;
    return proceedAfterDate(chatId, user, date);
  }

  if (kind === 'person' && session.state === 'awaiting_person_pick') {
    const rosterId = Number(value);
    const roster = activeRosterForDate(session.data.date);
    const person = roster.find((p) => p.id === rosterId);
    if (!person) return telegramApi.sendMessage(chatId, 'That person is no longer eligible for that date. /cancel and try again.');

    setSession(chatId, 'awaiting_status', { ...session.data, rosterId, personName: person.name });
    return askStatus(chatId, user, session.data.date, person.name);
  }

  if (kind === 'status' && session.state === 'awaiting_status') {
    if (value === 'off') {
      setSession(chatId, 'awaiting_off_period', { ...session.data, status: 'off' });
      return telegramApi.sendMessage(
        chatId,
        'Which period?',
        telegramApi.inlineKeyboard([OFF_PERIODS.map((p) => ({ text: p === 'TIME' ? 'Custom time' : p, data: `period:${p}` }))])
      );
    }
    if (value === 'mc') {
      setSession(chatId, 'awaiting_mc_detail', { ...session.data, status: 'mc' });
      return telegramApi.sendMessage(
        chatId,
        'Optional: send a reason, a photo of the MC, or type "skip".',
        telegramApi.inlineKeyboard([[{ text: 'Skip', data: 'mc:skip' }]])
      );
    }
    // present / outpro have no further detail needed
    return finalizeSubmission(chatId, user, { ...session.data, status: value });
  }

  if (kind === 'period' && session.state === 'awaiting_off_period') {
    if (value === 'TIME') {
      setSession(chatId, 'awaiting_off_time', { ...session.data, offPeriod: 'TIME' });
      return telegramApi.sendMessage(chatId, 'What time does it start? (e.g. 14:30)');
    }
    return finalizeSubmission(chatId, user, { ...session.data, offPeriod: value });
  }

  if (kind === 'mc' && value === 'skip' && session.state === 'awaiting_mc_detail') {
    return finalizeSubmission(chatId, user, session.data);
  }
}

/** Link count/cap for a user, used by the My Account page (KAH accounts allow up to 5, others 1). */
function getLinkStatus(userId, username) {
  return { count: countLinks(userId), cap: linkCapFor(username), isKah: db.isKahUsername(username) };
}

module.exports = { handleUpdate, generateLinkCode, getSession, setSession, clearSession, getLinkStatus };
