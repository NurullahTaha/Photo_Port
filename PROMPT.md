# Build Prompt — Three.js Photography Portfolio with Admin CMS

> A reusable, detailed prompt for generating this project (or a variant of it)
> with an AI coding agent.

---

Build me a complete, production-ready photography portfolio website with a
**Three.js WebGL front end** and a **self-hosted admin CMS**. No external
database or cloud services — everything must run from a single Node.js app.

## 1. Public site (guest view) — award-winning visual design

Design language: dark, editorial, gallery-like. Near-black background
(`#0c0c0e`), warm off-white type, a champagne accent color, a high-contrast
pairing of a display serif (e.g. Fraunces) for titles with a clean grotesque
(e.g. Manrope) for micro-labels in uppercase with wide letter-spacing.

Required experience, in the style of Awwwards/FWA winners:

1. **Preloader**: site title, thin progress bar and a large serif percentage
   counter tied to real texture loading; exits with a clip-path wipe.
2. **WebGL gallery**: an infinite horizontal strip of photo planes on a gently
   curved band (subtle Z-arc and Y-rotation toward the edges). Controlled by
   mouse wheel, touch/pointer drag and arrow keys, with damped inertia.
3. **Custom GLSL shaders**: planes shear/bulge with scroll velocity; chromatic
   aberration proportional to speed; cover-fit UV mapping; hover state that
   brightens and slightly zooms the texture; staggered "unfold" reveal.
4. **Detail view**: clicking a photo first centers it in the strip, then FLIP
   transitions it from the WebGL plane into a focused DOM frame with title,
   collection name, index and prev/next navigation. Esc or backdrop click
   returns it to its plane.
5. **Collections menu**: full-screen overlay listing folders in huge serif
   type with index numbers and photo counts; hovering a row shows that
   collection's cover image as a ghost preview; clicking filters the gallery
   with a conceal/reveal transition.
6. **About overlay** fed by editable site settings (bio, contact email,
   Instagram).
7. **Atmosphere**: animated film grain, custom cursor (dot + ring that grows
   into a "View" pill over photos), persistent caption (collection, photo
   title, 02/14 counter), scroll hint that fades after first interaction.
8. **Quality bar**: respects `prefers-reduced-motion`, devicePixelRatio capped
   at 2, textures disposed on rebuild, graceful empty state pointing to
   `/admin`, works on mobile (touch drag, simplified layout).

## 2. Admin area (separate from guest view)

- `/admin` is its own page (separate bundle), never mixed with the guest UI.
- **Login screen**: minimal dark card; username + password; clear error
  states; rate-limited endpoint.
- **Dashboard** after login:
  - Sidebar: All photos, Unfiled, then folders with photo counts; create
    folder; reorder folders; site settings; view-site link; sign out.
  - Upload: button + whole-window drag-and-drop, multi-file, per-batch
    progress bar, type/size validation (JPEG/PNG/WebP/AVIF/GIF, ≤30 MB).
  - Photo cards: hover actions to edit (title, alt text, folder, featured),
    set as folder cover, delete (with confirm); drag to reorder inside a
    folder.
  - Folder management: create, rename, description, delete (cascades to its
    photos, with confirm).
  - Site settings modal: site title, photographer name, tagline, about,
    contact email, Instagram; change-password form.
  - Toast notifications for every action.

## 3. Backend

- Node.js + Express, ES modules. Single server serves the API, uploaded
  images and the built frontend.
- Persistence: JSON file (`server/data/db.json`) with atomic writes —
  folders, photos (id, folder, filename, title, alt, dimensions, featured,
  order), settings. Uploads stored on disk in `server/uploads/`.
- Auth: single admin; bcrypt-hashed password created on first run from
  `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars; HMAC-signed httpOnly SameSite
  session cookie (7-day expiry); login rate limiting; change-password
  endpoint.
- REST API: `POST /api/auth/login|logout`, `GET /api/auth/me`,
  `POST /api/auth/change-password`; CRUD + reorder for `/api/folders` and
  `/api/photos` (Multer multipart upload, image dimensions read server-side);
  `GET|PATCH /api/settings`. Public GETs, admin-only mutations.
- Image safety: whitelist mime types, randomize stored filenames, nosniff
  headers, long cache lifetimes for uploads.

## 4. Tooling & DX

- Vite multi-page build (`index.html`, `admin.html`) with dev proxy to the
  API; `npm run dev` runs server + Vite together; `npm run build` +
  `npm start` for production.
- A `npm run seed` script that procedurally generates placeholder gradient
  PNGs (pure Node, zlib-encoded) and demo folders so the site looks designed
  on first launch.
- Vanilla JS (no framework) + Three.js + GSAP only; keep dependencies light.
- README with quick start, env vars, deployment notes and default
  credentials warning.

Deliver clean, commented-where-it-matters code with a coherent file
structure: `client/src/gallery` (Three.js engine + shaders),
`client/src/admin` (dashboard SPA), `client/src/shared` (API helpers),
`server/routes` + `server/lib` (Express).
