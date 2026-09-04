function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Admins only.' });
  }
  next();
}

function requireEditor(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!['admin', 'editor'].includes(req.session.user.role)) {
    return res.status(403).render('error', { message: 'Admins and editors only.' });
  }
  next();
}

// "self" accounts (read-only, scoped to their own record) are redirected to
// their own page instead of the normal shared views everyone else uses.
function blockSelfRole(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role === 'self') return res.redirect('/my-attendance');
  next();
}

module.exports = { requireLogin, requireAdmin, requireEditor, blockSelfRole };
