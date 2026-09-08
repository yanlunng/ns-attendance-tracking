const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireLogin, requireAdmin } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const guidePath = path.join(__dirname, '..', '..', 'data', 'guide.pdf');

// Available to every logged-in role — the guide isn't tied to any KAH edit
// scope, it's the same document for everyone. Served from the same
// persistent volume as attendance.db/attachments, so an admin re-uploading
// a rebuilt guide survives container restarts/redeploys without needing a
// new image build.
router.get('/guide', requireLogin, (req, res) => {
  if (!fs.existsSync(guidePath)) {
    return res.status(404).render('error', { message: 'The user guide has not been uploaded yet — ask an admin to upload it via Roster.' });
  }
  res.sendFile(guidePath);
});

router.post('/guide/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.redirect('/roster?guideError=' + encodeURIComponent('No file uploaded.'));
  }
  if (req.file.mimetype !== 'application/pdf') {
    return res.redirect('/roster?guideError=' + encodeURIComponent('Only a PDF file can be uploaded as the guide.'));
  }
  fs.mkdirSync(path.dirname(guidePath), { recursive: true });
  fs.writeFileSync(guidePath, req.file.buffer);
  res.redirect('/roster');
});

module.exports = router;
