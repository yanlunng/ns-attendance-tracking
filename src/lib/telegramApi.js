const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const FILE_BASE = TOKEN ? `https://api.telegram.org/file/bot${TOKEN}` : null;

function enabled() {
  return !!TOKEN;
}

async function call(method, body) {
  if (!enabled()) throw new Error('TELEGRAM_BOT_TOKEN is not set.');
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram API ${method} failed: ${json.description || res.status}`);
  return json.result;
}

function sendMessage(chatId, text, options = {}) {
  return call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...options });
}

function answerCallbackQuery(callbackQueryId, text) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

function inlineKeyboard(rows) {
  // rows: array of arrays of { text, data }
  return { reply_markup: { inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } };
}

async function setWebhook(url, secretToken) {
  return call('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message', 'callback_query'] });
}

/** Populates the "/" command menu Telegram shows in the chat UI. */
async function setMyCommands(commands) {
  return call('setMyCommands', { commands });
}

/** Downloads a Telegram file (e.g. an MC photo) into the given local path. */
async function downloadFile(fileId, destPath) {
  if (!enabled()) throw new Error('TELEGRAM_BOT_TOKEN is not set.');
  const fileInfo = await call('getFile', { file_id: fileId });
  const res = await fetch(`${FILE_BASE}/${fileInfo.file_path}`);
  if (!res.ok) throw new Error(`Failed to download Telegram file: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

function generateWebhookSecret() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  enabled,
  sendMessage,
  answerCallbackQuery,
  inlineKeyboard,
  setWebhook,
  setMyCommands,
  downloadFile,
  generateWebhookSecret,
};
