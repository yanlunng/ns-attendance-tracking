require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

require('./db'); // ensures schema + bootstrap admin run before requests arrive

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const rosterRoutes = require('./routes/roster');
const userRoutes = require('./routes/users');
const exportRoutes = require('./routes/export');
const establishmentRoutes = require('./routes/establishment');
const approvalsRoutes = require('./routes/approvals');
const accountRoutes = require('./routes/account');
const myAttendanceRoutes = require('./routes/myAttendance');
const outfieldRoutes = require('./routes/outfield');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12h
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect(req.session.user.role === 'self' ? '/my-attendance' : '/attendance');
});

app.use(authRoutes);
app.use(attendanceRoutes);
app.use(rosterRoutes);
app.use(userRoutes);
app.use(exportRoutes);
app.use(establishmentRoutes);
app.use(approvalsRoutes);
app.use(accountRoutes);
app.use(myAttendanceRoutes);
app.use(outfieldRoutes);

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Attendance app listening on http://localhost:${port}`);
});
