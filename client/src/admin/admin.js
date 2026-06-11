import { api, uploadPhotos } from '../shared/api.js';

const app = document.getElementById('app');

const state = {
  user: null,
  folders: [],
  photos: [],
  settings: null,
  view: 'all', // 'all' | 'unfiled' | folderId
  uploads: [] // [{name, progress, error}]
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function esc(str) {
  return String(str ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function toast(message, kind = 'info') {
  const el = h(`<div class="toast toast-${kind}">${esc(message)}</div>`);
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.classList.add('visible'), 10);
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, 3400);
}

function modal(contentHtml) {
  const wrap = h(`
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true">${contentHtml}</div>
    </div>
  `);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  return { el: wrap.querySelector('.modal'), close };
}

function currentFolder() {
  return state.folders.find((f) => f.id === state.view) || null;
}

function visiblePhotos() {
  if (state.view === 'all') return state.photos;
  if (state.view === 'unfiled') return state.photos.filter((p) => !p.folderId);
  return state.photos.filter((p) => p.folderId === state.view);
}

async function refreshData() {
  const [foldersRes, photosRes] = await Promise.all([
    api.get('/api/folders'),
    api.get('/api/photos')
  ]);
  state.folders = foldersRes.folders;
  state.photos = photosRes.photos;
  if (state.view !== 'all' && state.view !== 'unfiled' && !currentFolder()) {
    state.view = 'all';
  }
}

// ---------------------------------------------------------------------------
// Login view
// ---------------------------------------------------------------------------
function renderLogin(message = '') {
  app.innerHTML = '';
  app.appendChild(
    h(`
    <div class="login-wrap">
      <form class="login-card" id="login-form">
        <p class="login-kicker">Photo Port</p>
        <h1>Admin Sign in</h1>
        <p class="login-sub">Manage your photographs and collections.</p>
        <label>Username
          <input name="username" type="text" autocomplete="username" required autofocus />
        </label>
        <label>Password
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <p class="login-error" ${message ? '' : 'hidden'}>${esc(message)}</p>
        <button type="submit" class="btn btn-primary btn-block">Sign in</button>
        <a class="login-back" href="/">&larr; Back to site</a>
      </form>
    </div>
  `)
  );
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const data = await api.post('/api/auth/login', {
        username: form.username.value.trim(),
        password: form.password.value
      });
      state.user = data.username;
      await enterDashboard();
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Dashboard shell
// ---------------------------------------------------------------------------
async function enterDashboard() {
  await refreshData();
  const settingsRes = await api.get('/api/settings');
  state.settings = settingsRes.settings;
  renderDashboard();
}

function renderDashboard() {
  app.innerHTML = '';
  app.appendChild(
    h(`
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <span class="brand-mark">${esc(state.settings?.siteTitle || 'Photo Port')}</span>
          <span class="brand-sub">Admin</span>
        </div>
        <nav class="folder-nav" id="folder-nav"></nav>
        <button class="btn btn-ghost btn-block" id="btn-new-folder">+ New folder</button>
        <div class="sidebar-foot">
          <button class="side-link" id="btn-settings">Site settings</button>
          <a class="side-link" href="/" target="_blank" rel="noopener">View site ↗</a>
          <button class="side-link" id="btn-logout">Sign out (${esc(state.user || 'admin')})</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar" id="topbar"></header>
        <div class="uploads" id="uploads"></div>
        <section class="grid-wrap" id="grid-wrap"></section>
      </main>
      <div class="dropzone-overlay" id="dropzone" hidden>
        <div class="dropzone-box">Drop photos to upload</div>
      </div>
    </div>
  `)
  );
  renderSidebar();
  renderTopbar();
  renderGrid();
  renderUploads();
  bindShell();
}

function bindShell() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    state.user = null;
    renderLogin();
  });
  document.getElementById('btn-new-folder').addEventListener('click', openFolderModal);
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);

  // Whole-window drag & drop upload
  const dropzone = document.getElementById('dropzone');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    dropzone.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth = 0;
    dropzone.hidden = true;
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) startUpload(files);
  });
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function renderSidebar() {
  const nav = document.getElementById('folder-nav');
  if (!nav) return;
  nav.innerHTML = '';

  const unfiledCount = state.photos.filter((p) => !p.folderId).length;
  const rows = [
    { id: 'all', name: 'All photos', count: state.photos.length },
    ...(unfiledCount ? [{ id: 'unfiled', name: 'Unfiled', count: unfiledCount }] : []),
    ...state.folders.map((f) => ({ id: f.id, name: f.name, count: f.photoCount, folder: f }))
  ];

  rows.forEach((row, idx) => {
    const active = state.view === row.id ? ' active' : '';
    const el = h(`
      <div class="folder-row${active}" data-id="${row.id}">
        <button class="folder-btn">
          <span class="folder-name">${esc(row.name)}</span>
          <span class="folder-count">${row.count}</span>
        </button>
        ${
          row.folder
            ? `<span class="folder-actions">
                 <button class="icon-btn" data-move="-1" title="Move up">↑</button>
                 <button class="icon-btn" data-move="1" title="Move down">↓</button>
               </span>`
            : ''
        }
      </div>
    `);
    el.querySelector('.folder-btn').addEventListener('click', () => {
      state.view = row.id;
      renderSidebar();
      renderTopbar();
      renderGrid();
    });
    el.querySelectorAll('[data-move]').forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await moveFolder(row.folder, Number(btn.dataset.move));
      })
    );
    nav.appendChild(el);
  });
}

async function moveFolder(folder, dir) {
  const ids = state.folders.map((f) => f.id);
  const i = ids.indexOf(folder.id);
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await api.post('/api/folders/reorder', { ids });
  await refreshData();
  renderSidebar();
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------
function renderTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const folder = currentFolder();
  const title =
    state.view === 'all' ? 'All photos' : state.view === 'unfiled' ? 'Unfiled' : folder.name;
  const count = visiblePhotos().length;

  bar.innerHTML = `
    <div class="topbar-meta">
      <h1>${esc(title)}</h1>
      <span class="topbar-count">${count} photo${count === 1 ? '' : 's'}</span>
      ${folder?.description ? `<p class="topbar-desc">${esc(folder.description)}</p>` : ''}
    </div>
    <div class="topbar-actions">
      ${
        folder
          ? `<button class="btn btn-ghost" id="btn-edit-folder">Edit folder</button>
             <button class="btn btn-danger-ghost" id="btn-delete-folder">Delete folder</button>`
          : ''
      }
      <button class="btn btn-primary" id="btn-upload">Upload photos</button>
      <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple hidden />
    </div>
  `;

  bar.querySelector('#btn-upload').addEventListener('click', () =>
    bar.querySelector('#file-input').click()
  );
  bar.querySelector('#file-input').addEventListener('change', (e) => {
    if (e.target.files.length) startUpload([...e.target.files]);
    e.target.value = '';
  });
  if (folder) {
    bar.querySelector('#btn-edit-folder').addEventListener('click', () => openFolderModal(folder));
    bar.querySelector('#btn-delete-folder').addEventListener('click', async () => {
      const ok = confirm(
        `Delete folder "${folder.name}" and its ${folder.photoCount} photo(s)? This cannot be undone.`
      );
      if (!ok) return;
      await api.del(`/api/folders/${folder.id}`);
      toast(`Folder "${folder.name}" deleted`);
      state.view = 'all';
      await refreshData();
      renderDashboard();
    });
  }
}

// ---------------------------------------------------------------------------
// Photo grid
// ---------------------------------------------------------------------------
function renderGrid() {
  const wrap = document.getElementById('grid-wrap');
  if (!wrap) return;
  const photos = visiblePhotos();
  const folder = currentFolder();
  wrap.innerHTML = '';

  if (!photos.length) {
    wrap.appendChild(
      h(`
      <div class="grid-empty">
        <p>No photos here yet.</p>
        <p class="grid-empty-sub">Click <strong>Upload photos</strong> or drop image files anywhere on this page.</p>
      </div>
    `)
    );
    return;
  }

  const grid = h(`<div class="photo-grid"></div>`);
  const sortable = state.view !== 'all';

  photos.forEach((photo) => {
    const isCover = folder && folder.coverPhotoId === photo.id;
    const card = h(`
      <article class="photo-card" data-id="${photo.id}" ${sortable ? 'draggable="true"' : ''}>
        <div class="thumb-wrap">
          <img class="thumb" src="${esc(photo.url)}" alt="${esc(photo.alt || photo.title)}" loading="lazy" draggable="false" />
          <div class="badges">
            ${isCover ? '<span class="badge badge-cover">Cover</span>' : ''}
            ${photo.featured ? '<span class="badge badge-featured">Featured</span>' : ''}
          </div>
          <div class="card-hover">
            <button class="chip" data-act="edit">Edit</button>
            ${folder && !isCover ? '<button class="chip" data-act="cover">Set cover</button>' : ''}
            <button class="chip chip-danger" data-act="delete">Delete</button>
          </div>
        </div>
        <div class="card-meta">
          <span class="card-title">${esc(photo.title || 'Untitled')}</span>
          <span class="card-dims">${photo.width || '?'}×${photo.height || '?'}</span>
        </div>
      </article>
    `);

    card.querySelector('[data-act=edit]').addEventListener('click', () => openPhotoModal(photo));
    card.querySelector('[data-act=delete]').addEventListener('click', async () => {
      if (!confirm(`Delete "${photo.title || 'this photo'}"? This cannot be undone.`)) return;
      await api.del(`/api/photos/${photo.id}`);
      toast('Photo deleted');
      await refreshData();
      renderSidebar();
      renderTopbar();
      renderGrid();
    });
    const coverBtn = card.querySelector('[data-act=cover]');
    if (coverBtn) {
      coverBtn.addEventListener('click', async () => {
        await api.patch(`/api/folders/${folder.id}`, { coverPhotoId: photo.id });
        toast('Cover updated');
        await refreshData();
        renderGrid();
      });
    }
    grid.appendChild(card);
  });

  if (sortable) enableReorder(grid);
  wrap.appendChild(grid);
  if (sortable && photos.length > 1) {
    wrap.appendChild(h(`<p class="reorder-hint">Drag photos to reorder them.</p>`));
  }
}

function enableReorder(grid) {
  let dragged = null;
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.photo-card');
    if (!card) return;
    dragged = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Required by Firefox to initiate a drag.
    e.dataTransfer.setData('text/plain', card.dataset.id);
  });
  grid.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    const over = e.target.closest('.photo-card');
    if (!over || over === dragged) return;
    const rect = over.getBoundingClientRect();
    const before = e.clientX - rect.left < rect.width / 2;
    grid.insertBefore(dragged, before ? over : over.nextSibling);
  });
  grid.addEventListener('dragend', async () => {
    if (!dragged) return;
    dragged.classList.remove('dragging');
    dragged = null;
    const ids = [...grid.querySelectorAll('.photo-card')].map((c) => c.dataset.id);
    await api.post('/api/photos/reorder', { ids });
    await refreshData();
    toast('Order saved');
  });
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
function uploadTargetFolderId() {
  return state.view !== 'all' && state.view !== 'unfiled' ? state.view : null;
}

async function startUpload(files) {
  const target = uploadTargetFolderId();
  const entry = {
    name: files.length === 1 ? files[0].name : `${files.length} photos`,
    progress: 0,
    error: null
  };
  state.uploads.push(entry);
  renderUploads();
  try {
    await uploadPhotos(files, target, (p) => {
      entry.progress = p;
      renderUploads();
    });
    state.uploads = state.uploads.filter((u) => u !== entry);
    toast(`Uploaded ${files.length} photo${files.length === 1 ? '' : 's'}`, 'success');
    await refreshData();
    renderSidebar();
    renderTopbar();
    renderGrid();
  } catch (err) {
    entry.error = err.message;
    toast(err.message, 'error');
  }
  renderUploads();
}

function renderUploads() {
  const box = document.getElementById('uploads');
  if (!box) return;
  box.innerHTML = '';
  for (const u of state.uploads) {
    const row = h(`
      <div class="upload-row${u.error ? ' upload-error' : ''}">
        <span class="upload-name">${esc(u.name)}</span>
        ${
          u.error
            ? `<span class="upload-msg">${esc(u.error)}</span><button class="icon-btn" data-dismiss>×</button>`
            : `<span class="upload-pct">${Math.round(u.progress * 100)}%</span>
               <span class="upload-track"><span class="upload-bar" style="width:${u.progress * 100}%"></span></span>`
        }
      </div>
    `);
    const dismiss = row.querySelector('[data-dismiss]');
    if (dismiss) {
      dismiss.addEventListener('click', () => {
        state.uploads = state.uploads.filter((x) => x !== u);
        renderUploads();
      });
    }
    box.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Modals: folder / photo / settings
// ---------------------------------------------------------------------------
function openFolderModal(folder = null) {
  const isEdit = !!folder?.id;
  const { el, close } = modal(`
    <h2>${isEdit ? 'Edit folder' : 'New folder'}</h2>
    <form id="folder-form">
      <label>Name
        <input name="name" type="text" required maxlength="80" value="${esc(folder?.name || '')}" />
      </label>
      <label>Description <span class="label-hint">(shown in the collections menu)</span>
        <textarea name="description" rows="3" maxlength="500">${esc(folder?.description || '')}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </form>
  `);
  el.querySelector('[data-cancel]').addEventListener('click', close);
  el.querySelector('input[name=name]').focus();
  el.querySelector('#folder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      if (isEdit) {
        await api.patch(`/api/folders/${folder.id}`, {
          name: form.name.value,
          description: form.description.value
        });
        toast('Folder updated');
      } else {
        const res = await api.post('/api/folders', {
          name: form.name.value,
          description: form.description.value
        });
        state.view = res.folder.id;
        toast('Folder created');
      }
      close();
      await refreshData();
      renderSidebar();
      renderTopbar();
      renderGrid();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openPhotoModal(photo) {
  const folderOptions = [
    `<option value="">Unfiled</option>`,
    ...state.folders.map(
      (f) =>
        `<option value="${f.id}" ${f.id === photo.folderId ? 'selected' : ''}>${esc(f.name)}</option>`
    )
  ].join('');

  const { el, close } = modal(`
    <h2>Edit photo</h2>
    <div class="modal-preview"><img src="${esc(photo.url)}" alt="" /></div>
    <form id="photo-form">
      <label>Title
        <input name="title" type="text" maxlength="120" value="${esc(photo.title)}" />
      </label>
      <label>Alt text <span class="label-hint">(accessibility)</span>
        <input name="alt" type="text" maxlength="240" value="${esc(photo.alt)}" />
      </label>
      <label>Folder
        <select name="folderId">${folderOptions}</select>
      </label>
      <label class="check-label">
        <input name="featured" type="checkbox" ${photo.featured ? 'checked' : ''} /> Featured photo
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  el.querySelector('[data-cancel]').addEventListener('click', close);
  el.querySelector('#photo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await api.patch(`/api/photos/${photo.id}`, {
        title: form.title.value,
        alt: form.alt.value,
        folderId: form.folderId.value || null,
        featured: form.featured.checked
      });
      toast('Photo updated');
      close();
      await refreshData();
      renderSidebar();
      renderTopbar();
      renderGrid();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openSettingsModal() {
  const s = state.settings || {};
  const { el, close } = modal(`
    <h2>Site settings</h2>
    <form id="settings-form">
      <div class="form-grid">
        <label>Site title
          <input name="siteTitle" type="text" maxlength="60" value="${esc(s.siteTitle)}" />
        </label>
        <label>Photographer name
          <input name="photographer" type="text" maxlength="80" value="${esc(s.photographer)}" />
        </label>
      </div>
      <label>Tagline
        <input name="tagline" type="text" maxlength="160" value="${esc(s.tagline)}" />
      </label>
      <label>About
        <textarea name="about" rows="5" maxlength="2000">${esc(s.about)}</textarea>
      </label>
      <div class="form-grid">
        <label>Contact email
          <input name="contactEmail" type="email" maxlength="120" value="${esc(s.contactEmail)}" />
        </label>
        <label>Instagram <span class="label-hint">(handle or URL)</span>
          <input name="instagram" type="text" maxlength="120" value="${esc(s.instagram)}" />
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">Save settings</button>
      </div>
    </form>
    <hr class="modal-rule" />
    <h3>Change password</h3>
    <form id="password-form">
      <div class="form-grid">
        <label>Current password
          <input name="currentPassword" type="password" autocomplete="current-password" required />
        </label>
        <label>New password <span class="label-hint">(min 8 chars)</span>
          <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
        </label>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-ghost">Update password</button>
      </div>
    </form>
  `);
  el.querySelector('[data-cancel]').addEventListener('click', close);

  el.querySelector('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      const res = await api.patch('/api/settings', {
        siteTitle: form.siteTitle.value,
        photographer: form.photographer.value,
        tagline: form.tagline.value,
        about: form.about.value,
        contactEmail: form.contactEmail.value,
        instagram: form.instagram.value
      });
      state.settings = res.settings;
      toast('Settings saved');
      close();
      renderDashboard();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  el.querySelector('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: form.currentPassword.value,
        newPassword: form.newPassword.value
      });
      toast('Password changed', 'success');
      form.reset();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    if (me.authenticated) {
      state.user = me.username;
      await enterDashboard();
    } else {
      renderLogin();
    }
  } catch (err) {
    app.innerHTML = `<div class="boot">Could not reach the server: ${esc(err.message)}</div>`;
  }
})();
