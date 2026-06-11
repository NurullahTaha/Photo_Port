import { Router } from 'express';
import { getDB, saveDB } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

const FIELDS = [
  'siteTitle',
  'photographer',
  'tagline',
  'about',
  'contactEmail',
  'instagram'
];

router.get('/', (req, res) => {
  res.json({ settings: getDB().settings });
});

router.patch('/', requireAuth, (req, res) => {
  const db = getDB();
  const body = req.body || {};
  for (const field of FIELDS) {
    if (body[field] !== undefined) {
      db.settings[field] = String(body[field]).trim().slice(0, 2000);
    }
  }
  saveDB();
  res.json({ settings: db.settings });
});

export default router;
