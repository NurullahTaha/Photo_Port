import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDirs, UPLOADS_DIR, DIST_DIR } from './lib/paths.js';
import { ensureAdmin } from './lib/auth.js';
import { getDB } from './lib/db.js';
import authRoutes from './routes/auth.js';
import folderRoutes from './routes/folders.js';
import photoRoutes from './routes/photos.js';
import settingsRoutes from './routes/settings.js';

ensureDirs();
ensureAdmin();
getDB();

const app = express();
const PORT = process.env.PORT || 4321;

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/settings', settingsRoutes);

app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    immutable: true,
    maxAge: '30d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
  })
);

// In production, serve the built frontend. In dev, Vite serves it instead.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/admin(\/.*)?$/, (req, res) =>
    res.sendFile(path.join(DIST_DIR, 'admin.html'))
  );
  app.get(/^\/(?!api\/|uploads\/).*/, (req, res) =>
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  );
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[server] Photo Port API on http://localhost:${PORT}`);
  if (!fs.existsSync(DIST_DIR)) {
    console.log('[server] No dist/ build found - run the Vite dev server or `npm run build`.');
  }
});
