const express = require('express');
const telegramBot = require('../lib/telegramBot');

const router = express.Router();

router.post('/telegram/webhook', express.json(), async (req, res) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const gotSecret = req.get('X-Telegram-Bot-Api-Secret-Token');
    if (gotSecret !== expectedSecret) return res.sendStatus(401);
  }

  // Ack immediately — Telegram retries if a webhook is slow to respond, and
  // our processing (a couple of DB calls + one outgoing API call) shouldn't
  // block that ack.
  res.sendStatus(200);

  try {
    await telegramBot.handleUpdate(req.body);
  } catch (err) {
    console.error('[telegram] failed to handle update:', err);
  }
});

module.exports = router;
