import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDirs } from './paths.js';

const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  folders: [],
  photos: [],
  settings: {
    siteTitle: 'PHOTO PORT',
    photographer: 'Your Name',
    tagline: 'Visual stories in light and shadow',
    about:
      'I am a photographer chasing quiet moments and honest light. ' +
      'This portfolio is a living archive of the places, faces and ' +
      'fragments that stay with me.',
    contactEmail: '',
    instagram: ''
  }
};

let cache = null;

export function getDB() {
  if (cache) return cache;
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      cache = {
        ...structuredClone(DEFAULT_DB),
        ...raw,
        settings: { ...DEFAULT_DB.settings, ...(raw.settings || {}) }
      };
    } catch {
      cache = structuredClone(DEFAULT_DB);
    }
  } else {
    cache = structuredClone(DEFAULT_DB);
    saveDB();
  }
  return cache;
}

export function saveDB() {
  if (!cache) return;
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function slugify(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'untitled'
  );
}

export function uniqueSlug(name, existing) {
  const base = slugify(name);
  let slug = base;
  let i = 2;
  const taken = new Set(existing);
  while (taken.has(slug)) slug = `${base}-${i++}`;
  return slug;
}
