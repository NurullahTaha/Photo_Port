import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { getDB, saveDB, uniqueSlug } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { UPLOADS_DIR } from '../lib/paths.js';

const router = Router();

function publicFolder(folder, db) {
  const photos = db.photos.filter((p) => p.folderId === folder.id);
  const cover =
    photos.find((p) => p.id === folder.coverPhotoId) || photos[0] || null;
  return {
    id: folder.id,
    name: folder.name,
    slug: folder.slug,
    description: folder.description || '',
    order: folder.order,
    photoCount: photos.length,
    coverPhotoId: folder.coverPhotoId || null,
    coverUrl: cover ? `/uploads/${cover.filename}` : null,
    createdAt: folder.createdAt
  };
}

router.get('/', (req, res) => {
  const db = getDB();
  const folders = [...db.folders]
    .sort((a, b) => a.order - b.order)
    .map((f) => publicFolder(f, db));
  res.json({ folders });
});

router.post('/', requireAuth, (req, res) => {
  const { name, description } = req.body || {};
  const trimmed = String(name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Folder name is required' });
  if (trimmed.length > 80) return res.status(400).json({ error: 'Folder name is too long' });

  const db = getDB();
  const folder = {
    id: crypto.randomUUID(),
    name: trimmed,
    slug: uniqueSlug(trimmed, db.folders.map((f) => f.slug)),
    description: String(description || '').trim(),
    coverPhotoId: null,
    order: db.folders.length,
    createdAt: new Date().toISOString()
  };
  db.folders.push(folder);
  saveDB();
  res.status(201).json({ folder: publicFolder(folder, db) });
});

router.patch('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const folder = db.folders.find((f) => f.id === req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const { name, description, coverPhotoId } = req.body || {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ error: 'Folder name is required' });
    if (trimmed.length > 80) return res.status(400).json({ error: 'Folder name is too long' });
    if (trimmed !== folder.name) {
      folder.name = trimmed;
      folder.slug = uniqueSlug(
        trimmed,
        db.folders.filter((f) => f.id !== folder.id).map((f) => f.slug)
      );
    }
  }
  if (description !== undefined) folder.description = String(description).trim();
  if (coverPhotoId !== undefined) {
    if (coverPhotoId === null) {
      folder.coverPhotoId = null;
    } else {
      const photo = db.photos.find(
        (p) => p.id === coverPhotoId && p.folderId === folder.id
      );
      if (!photo) return res.status(400).json({ error: 'Cover photo must belong to the folder' });
      folder.coverPhotoId = coverPhotoId;
    }
  }
  saveDB();
  res.json({ folder: publicFolder(folder, db) });
});

router.post('/reorder', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array is required' });
  const db = getDB();
  ids.forEach((id, index) => {
    const folder = db.folders.find((f) => f.id === id);
    if (folder) folder.order = index;
  });
  db.folders.sort((a, b) => a.order - b.order).forEach((f, i) => (f.order = i));
  saveDB();
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const idx = db.folders.findIndex((f) => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Folder not found' });

  const folderId = db.folders[idx].id;
  const photos = db.photos.filter((p) => p.folderId === folderId);
  for (const photo of photos) {
    const file = path.join(UPLOADS_DIR, path.basename(photo.filename));
    fs.rm(file, { force: true }, () => {});
  }
  db.photos = db.photos.filter((p) => p.folderId !== folderId);
  db.folders.splice(idx, 1);
  db.folders.sort((a, b) => a.order - b.order).forEach((f, i) => (f.order = i));
  saveDB();
  res.json({ ok: true, deletedPhotos: photos.length });
});

export default router;
