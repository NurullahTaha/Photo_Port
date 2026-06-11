import { Router } from 'express';
import {
  verifyCredentials,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAuth,
  loginRateLimit,
  recordFailedLogin,
  resetLoginAttempts,
  setAdminPassword,
  getAdmin
} from '../lib/auth.js';

const router = Router();

router.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (!verifyCredentials(username, password)) {
    recordFailedLogin(req);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  resetLoginAttempts(req);
  setSessionCookie(res, signSession(username));
  res.json({ ok: true, username });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: session.u });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const admin = getAdmin();
  if (!verifyCredentials(admin.username, currentPassword)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  setAdminPassword(String(newPassword));
  res.json({ ok: true });
});

export default router;
