/**
 * Seeds the portfolio with demo folders and procedurally generated
 * placeholder images (duotone gradients with grain, encoded as PNG with
 * nothing but Node's zlib). Replace them with real photographs from the
 * admin dashboard. Run with --force to re-seed a non-empty library.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getDB, saveDB, uniqueSlug } from '../lib/db.js';
import { ensureDirs, UPLOADS_DIR } from '../lib/paths.js';

// --- minimal PNG encoder ----------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    rgb.copy(raw, row + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- artful gradient generator ---------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeImage({ width, height, from, to, accent, seed }) {
  const rnd = mulberry32(seed);
  const rgb = Buffer.alloc(width * height * 3);
  const angle = rnd() * Math.PI * 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const cx = 0.3 + rnd() * 0.4;
  const cy = 0.3 + rnd() * 0.4;
  const blobR = 0.25 + rnd() * 0.3;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      // Diagonal duotone gradient
      let t = (u - 0.5) * dx + (v - 0.5) * dy + 0.5;
      t = Math.min(1, Math.max(0, t));
      let r = from[0] + (to[0] - from[0]) * t;
      let g = from[1] + (to[1] - from[1]) * t;
      let b = from[2] + (to[2] - from[2]) * t;
      // Soft accent "light" blob
      const d = Math.hypot(u - cx, v - cy);
      const glow = Math.max(0, 1 - d / blobR) ** 2 * 0.55;
      r += (accent[0] - r) * glow;
      g += (accent[1] - g) * glow;
      b += (accent[2] - b) * glow;
      // Film grain + vignette
      const grain = (rnd() - 0.5) * 14;
      const vd = Math.hypot(u - 0.5, v - 0.5);
      const vig = 1 - vd * vd * 0.7;
      const i = (y * width + x) * 3;
      rgb[i] = Math.min(255, Math.max(0, (r + grain) * vig));
      rgb[i + 1] = Math.min(255, Math.max(0, (g + grain) * vig));
      rgb[i + 2] = Math.min(255, Math.max(0, (b + grain) * vig));
    }
  }
  return encodePNG(width, height, rgb);
}

// --- seed data ---------------------------------------------------------------
const COLLECTIONS = [
  {
    name: 'Portraits',
    description: 'Faces, gestures and the quiet space between them.',
    photos: [
      { title: 'Amber Hour', w: 1200, h: 1600, from: [24, 18, 28], to: [196, 122, 84], accent: [255, 214, 170] },
      { title: 'Still Waters', w: 1200, h: 1600, from: [12, 24, 32], to: [96, 140, 152], accent: [220, 240, 245] },
      { title: 'Northern Gaze', w: 1280, h: 1600, from: [20, 20, 24], to: [130, 130, 150], accent: [235, 235, 245] },
      { title: 'Velvet Study', w: 1200, h: 1500, from: [30, 14, 20], to: [160, 80, 96], accent: [255, 200, 210] }
    ]
  },
  {
    name: 'Landscapes',
    description: 'Open country, weather fronts and the long horizon.',
    photos: [
      { title: 'Silver Coast', w: 1600, h: 1066, from: [18, 22, 30], to: [140, 160, 175], accent: [240, 245, 250] },
      { title: 'Dune Light', w: 1600, h: 1066, from: [40, 28, 18], to: [216, 168, 110], accent: [255, 235, 190] },
      { title: 'Last Ridge', w: 1600, h: 1200, from: [14, 16, 26], to: [90, 110, 160], accent: [200, 215, 255] },
      { title: 'Green Hollow', w: 1600, h: 1066, from: [12, 26, 18], to: [110, 150, 110], accent: [225, 245, 215] }
    ]
  },
  {
    name: 'Street',
    description: 'Unscripted city scenes caught at walking pace.',
    photos: [
      { title: 'Crossing No. 7', w: 1400, h: 1400, from: [16, 16, 18], to: [120, 116, 110], accent: [250, 244, 230] },
      { title: 'Neon Interval', w: 1200, h: 1600, from: [20, 10, 30], to: [180, 60, 130], accent: [255, 170, 220] },
      { title: 'Rain Delay', w: 1400, h: 1050, from: [14, 18, 24], to: [88, 104, 124], accent: [210, 225, 240] },
      { title: 'Late Shift', w: 1200, h: 1600, from: [26, 18, 12], to: [200, 140, 70], accent: [255, 220, 160] }
    ]
  }
];

const force = process.argv.includes('--force');
ensureDirs();
const db = getDB();

if ((db.photos.length > 0 || db.folders.length > 0) && !force) {
  console.log('[seed] Library is not empty - skipping. Use --force to re-seed.');
  process.exit(0);
}

if (force) {
  for (const photo of db.photos) {
    fs.rmSync(path.join(UPLOADS_DIR, path.basename(photo.filename)), { force: true });
  }
  db.photos = [];
  db.folders = [];
}

let seed = 7;
let featuredBudget = 4;
for (const [folderIdx, col] of COLLECTIONS.entries()) {
  const folder = {
    id: crypto.randomUUID(),
    name: col.name,
    slug: uniqueSlug(col.name, db.folders.map((f) => f.slug)),
    description: col.description,
    coverPhotoId: null,
    order: folderIdx,
    createdAt: new Date().toISOString()
  };
  db.folders.push(folder);

  col.photos.forEach((spec, i) => {
    const filename = `seed-${folder.slug}-${i + 1}.png`;
    const png = makeImage({
      width: spec.w,
      height: spec.h,
      from: spec.from,
      to: spec.to,
      accent: spec.accent,
      seed: seed++
    });
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), png);
    const photo = {
      id: crypto.randomUUID(),
      folderId: folder.id,
      filename,
      title: spec.title,
      alt: `${spec.title} - placeholder image`,
      width: spec.w,
      height: spec.h,
      featured: featuredBudget-- > 0,
      order: i,
      createdAt: new Date().toISOString()
    };
    db.photos.push(photo);
    if (i === 0) folder.coverPhotoId = photo.id;
    console.log(`[seed] ${col.name} / ${spec.title} (${spec.w}x${spec.h})`);
  });
}

saveDB();
console.log(`[seed] Done: ${db.folders.length} folders, ${db.photos.length} photos.`);
