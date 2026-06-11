# Photo Port

An award-style photography portfolio built with **Three.js**, with a full
admin dashboard for managing photos and collections — no external database
or cloud service required.

## Features

**Public site** (`/`)
- WebGL infinite photo strip: drag, scroll or use arrow keys to glide through
  photographs on a gently curved 3D band
- Custom GLSL shaders: velocity-based bending, chromatic aberration on motion,
  hover lift and a per-plane vignette
- Click a photo and it centers itself, then expands into a focused detail view
  with keyboard navigation (`←` `→` `Esc`)
- Collections menu with live cover previews, About overlay, animated preloader,
  film grain, custom cursor
- Respects `prefers-reduced-motion`, falls back gracefully on touch devices

**Admin dashboard** (`/admin`)
- Login page with rate-limited, bcrypt-backed authentication
  (HMAC-signed httpOnly session cookie)
- Drag-and-drop multi-file uploads with progress bars (JPEG/PNG/WebP/AVIF/GIF,
  up to 30 MB each)
- Folders (collections): create, rename, describe, reorder, delete
- Photos: edit title/alt text, move between folders, feature, set folder cover,
  drag to reorder, delete
- Site settings: title, photographer name, tagline, about text, contact email,
  Instagram — plus change password

## Quick start

```bash
npm install
npm run seed     # optional: demo collections with generated placeholder images
npm run dev      # API on :4321, site on http://localhost:5173
```

- Public site: http://localhost:5173
- Admin: http://localhost:5173/admin — default login **admin / changeme**
  (change it right away in Site settings → Change password)

## Production

```bash
npm run build    # bundles the frontend into dist/
npm start        # serves site + API on http://localhost:4321
```

Set environment variables before first run (see `.env.example`):

| Variable         | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `PORT`           | Server port (default `4321`)                         |
| `ADMIN_USERNAME` | Admin username, used on first run (default `admin`)  |
| `ADMIN_PASSWORD` | Admin password, used on first run (default `changeme`) |
| `SESSION_SECRET` | Cookie-signing secret (auto-generated if unset)      |
| `TRUST_PROXY`    | Set `1` behind an HTTPS reverse proxy (Secure cookies) |

Data lives on disk and is trivial to back up:

- `server/data/db.json` — folders, photos metadata, site settings
- `server/data/auth.json` — admin credentials (bcrypt hash)
- `server/uploads/` — original image files

## Tech

| Layer    | Choice                                                  |
| -------- | ------------------------------------------------------- |
| 3D       | Three.js (custom `ShaderMaterial`, no post-processing deps) |
| Motion   | GSAP                                                    |
| Build    | Vite (multi-page: `index.html` + `admin.html`)          |
| Server   | Express + Multer, JSON-file persistence                 |
| Auth     | bcryptjs + HMAC-signed session cookies                  |

## Project layout

```
index.html / admin.html     Vite entry points
client/src/main.js          public site bootstrap, overlays, detail view
client/src/gallery/         Three.js gallery engine + GLSL shaders
client/src/admin/           admin SPA
client/src/shared/api.js    fetch/upload helpers
server/index.js             Express app
server/routes/              auth, folders, photos, settings
server/lib/                 db (JSON), auth (sessions), paths
server/scripts/seed.mjs     demo data + procedural placeholder PNGs
```
