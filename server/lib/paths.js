import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(ROOT_DIR, 'server', 'data');
export const UPLOADS_DIR = path.join(ROOT_DIR, 'server', 'uploads');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');

export function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOADS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
