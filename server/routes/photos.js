import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import imageSize from 'image-size';
import { getDB, saveDB } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { UPLOADS_DIR } from '../lib/paths.js';

const router = Router();

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif'
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = MIME_EXT[file.mimetype] || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Unsupported file type. Use JPEG, PNG, WebP, AVIF or GIF.'));
  }
});

function publicPhoto(photo) {
  return {
    id: photo.id,
    folderId: photo.folderId,
    url: `/uploads/${photo.filename}`,
    title: photo.title || '',
    alt: photo.alt || '',
    width: photo.width || 0,
    height: photo.height || 0,
    featured: !!photo.featured,
    order: photo.order,
    createdAt: photo.createdAt
  };
}

function sortPhotos(db, photos) {
  const folderOrder = new Map(db.folders.map((f) => [f.id, f.order]));
  return [...photos].sort(
    (a, b) =>
      (folderOrder.get(a.folderId) ?? 0) - (folderOrder.get(b.folderId) ?? 0) ||
      a.order - b.order
  );
}

router.get('/', (req, res) => {
  const db = getDB();
  let photos = db.photos;
  const { folder, featured } = req.query;
  if (folder) {
    const f = db.folders.find((x) => x.slug === folder || x.id === folder);
    if (!f) return res.status(404).json({ error: 'Folder not found' });
    photos = photos.filter((p) => p.folderId === f.id);
  }
  if (featured === '1') photos = photos.filter((p) => p.featured);
  res.json({ photos: sortPhotos(db, photos).map(publicPhoto) });
});

router.post('/', requireAuth, (req, res) => {
  upload.array('photos', 20)(req, res, (err) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'File too large (max 30 MB)'
          : err.message || 'Upload failed';
      return res.status(400).json({ error: message });
    }
    const db = getDB();
    const folderId = req.body.folderId || null;
    if (folderId && !db.folders.find((f) => f.id === folderId)) {
      for (const file of req.files || []) fs.rm(file.path, { force: true }, () => {});
      return res.status(400).json({ error: 'Folder not found' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files received' });
    }

    const maxOrder = db.photos
      .filter((p) => p.folderId === folderId)
      .reduce((m, p) => Math.max(m, p.order), -1);

    const created = req.files.map((file, i) => {
      let width = 0;
      let height = 0;
      try {
        const dim = imageSize(file.path);
        width = dim.width || 0;
        height = dim.height || 0;
      } catch {
        // Keep the upload even if dimensions can't be read.
      }
      const photo = {
        id: crypto.randomUUID(),
        folderId,
        filename: file.filename,
        title: path.parse(file.originalname).name.replace(/[-_]+/g, ' ').trim(),
        alt: '',
        width,
        height,
        featured: false,
        order: maxOrder + 1 + i,
        createdAt: new Date().toISOString()
      };
      db.photos.push(photo);
      return photo;
    });
    saveDB();
    res.status(201).json({ photos: created.map(publicPhoto) });
  });
});

router.patch('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const photo = db.photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  const { title, alt, folderId, featured } = req.body || {};
  if (title !== undefined) photo.title = String(title).trim().slice(0, 120);
  if (alt !== undefined) photo.alt = String(alt).trim().slice(0, 240);
  if (featured !== undefined) photo.featured = !!featured;
  if (folderId !== undefined && folderId !== photo.folderId) {
    if (folderId !== null && !db.folders.find((f) => f.id === folderId)) {
      return res.status(400).json({ error: 'Folder not found' });
    }
    // Clear cover reference in the folder it is leaving.
    const oldFolder = db.folders.find((f) => f.coverPhotoId === photo.id);
    if (oldFolder) oldFolder.coverPhotoId = null;
    photo.folderId = folderId;
    photo.order =
      db.photos
        .filter((p) => p.folderId === folderId && p.id !== photo.id)
        .reduce((m, p) => Math.max(m, p.order), -1) + 1;
  }
  saveDB();
  res.json({ photo: publicPhoto(photo) });
});

router.post('/reorder', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array is required' });
  const db = getDB();
  ids.forEach((id, index) => {
    const photo = db.photos.find((p) => p.id === id);
    if (photo) photo.order = index;
  });
  saveDB();
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const idx = db.photos.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Photo not found' });

  const photo = db.photos[idx];
  const file = path.join(UPLOADS_DIR, path.basename(photo.filename));
  fs.rm(file, { force: true }, () => {});
  for (const folder of db.folders) {
    if (folder.coverPhotoId === photo.id) folder.coverPhotoId = null;
  }
  db.photos.splice(idx, 1);
  saveDB();
  res.json({ ok: true });
});

export default router;
