import gsap from 'gsap';
import { api } from './shared/api.js';
import { Gallery, REDUCED_MOTION, FINE_POINTER } from './gallery/Gallery.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  settings: null,
  folders: [],
  photos: [], // photos of the current view (unique, ordered)
  folder: null, // null = all work
  detailIndex: -1,
  detailOpen: false,
  switching: false
};

let gallery = null;

const isReady = () => document.body.classList.contains('ready');

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  marquee.track = $('.marquee-track');
  marquee.bar = $('#progress span');
  initGrain();
  initCursor();

  const [settingsRes, foldersRes, photosRes] = await Promise.all([
    api.get('/api/settings'),
    api.get('/api/folders'),
    api.get('/api/photos')
  ]);
  state.settings = settingsRes.settings;
  state.folders = foldersRes.folders;
  state.photos = photosRes.photos;

  applySettings();
  buildCollectionsList();
  initOverlays();
  initKeyboard();
  initMagnetics();

  if (!state.photos.length) {
    $('#preloader').remove();
    $('#empty-state').hidden = false;
    document.body.classList.add('ready', 'empty');
    return;
  }

  gallery = new Gallery($('#gl'));
  gallery.onCenterChange = updateCaption;
  gallery.onItemClick = (item) => openDetail(item.photo, item);
  gallery.onHoverChange = (item) => {
    document.body.classList.toggle('photo-hover', !!item);
  };
  gallery.onFrame = onGalleryFrame;

  const counter = { value: 0 };
  const countEl = $('.preloader-count');
  const barEl = $('.preloader-bar');
  const entries = await gallery.preload(state.photos, (p) => {
    gsap.to(counter, {
      value: p * 100,
      duration: 0.4,
      ease: 'power1.out',
      onUpdate: () => {
        countEl.textContent = String(Math.round(counter.value)).padStart(2, '0');
        barEl.style.transform = `scaleX(${counter.value / 100})`;
      }
    });
  });

  gallery.build(entries, { entered: false });
  setMarqueeText(marqueeName());
  // Re-measure the loop segment once webfonts finish loading.
  document.fonts?.ready.then(() => {
    const text = marquee.text;
    marquee.text = '';
    setMarqueeText(text);
  });

  if (REDUCED_MOTION) {
    $('#preloader').remove();
    document.body.classList.add('ready');
    updateCaption(gallery.centerItem);
  } else {
    playIntro();
  }

  const dismissHint = () => {
    document.body.classList.add('hinted');
    window.removeEventListener('wheel', dismissHint);
    window.removeEventListener('pointerdown', dismissHint);
  };
  window.addEventListener('wheel', dismissHint, { passive: true });
  window.addEventListener('pointerdown', dismissHint);
}

function marqueeName() {
  return state.folder
    ? state.folder.name
    : state.settings.photographer || state.settings.siteTitle || 'Photographs';
}

// ---------------------------------------------------------------------------
// Intro choreography: preloader wipe -> name reveal -> deck fan-out ->
// title morphs into the header brand -> UI enters in order.
// ---------------------------------------------------------------------------
function buildIntroTitle() {
  const el = $('#intro-title');
  el.innerHTML = '';
  const name = state.settings.photographer || state.settings.siteTitle || '';
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const line = document.createElement('div');
    line.className = 'intro-line';
    const inner = document.createElement('span');
    inner.className = 'intro-line-inner';
    inner.textContent = word;
    line.appendChild(inner);
    el.appendChild(line);
  }
  if (state.settings.tagline) {
    const line = document.createElement('div');
    line.className = 'intro-line intro-line-tag';
    const inner = document.createElement('span');
    inner.className = 'intro-line-inner';
    inner.textContent = state.settings.tagline;
    line.appendChild(inner);
    el.appendChild(line);
  }
}

function shrinkTitleToBrand() {
  const title = $('#intro-title');
  const brand = $('.brand');
  const tl = gsap.timeline();
  tl.add(() => {
    // Measured at play time, after the lines have revealed.
    const tr = title.getBoundingClientRect();
    const br = brand.getBoundingClientRect();
    const scale = Math.max(0.05, br.height / Math.max(tr.height, 1));
    const dx = br.left + br.width / 2 - (tr.left + tr.width / 2);
    const dy = br.top + br.height / 2 - (tr.top + tr.height / 2);
    gsap.to(title, { x: dx, y: dy, scale, duration: 1.0, ease: 'expo.inOut' });
    gsap.to(title, { opacity: 0, duration: 0.3, delay: 0.55 });
    gsap.fromTo(
      brand,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.5, delay: 0.6 }
    );
    gsap.delayedCall(1.1, () => title.remove());
  });
  return tl;
}

function playIntro() {
  buildIntroTitle();
  const uiBits = ['.nav-link', '#caption', '#hint', '#admin-link', '#progress'];
  gsap.set(['.brand', ...uiBits], { opacity: 0 });
  updateCaption(gallery.centerItem);

  const tl = gsap.timeline();
  tl.to(
    $('#preloader'),
    {
      clipPath: 'inset(0 0 100% 0)',
      duration: 0.9,
      ease: 'expo.inOut',
      onComplete: () => $('#preloader').remove()
    },
    0.2
  );
  tl.fromTo(
    '.intro-line-inner',
    { yPercent: 115 },
    { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.14 },
    '-=0.35'
  );
  tl.add(gallery.introPlay(), '-=0.55');
  tl.add(shrinkTitleToBrand(), '-=2.0');
  tl.to('.nav-link', { opacity: 1, y: 0, duration: 0.6, stagger: 0.12 }, '-=1.0');
  tl.to('#caption', { opacity: 1, duration: 0.7 }, '-=0.7');
  tl.to(['#hint', '#admin-link', '#progress'], { opacity: 1, duration: 0.7 }, '-=0.45');
  tl.add(() => {
    document.body.classList.add('ready');
    gsap.set(['.brand', ...uiBits], { clearProps: 'opacity,transform' });
    updateCaption(gallery.centerItem);
  });
  if (window.innerWidth < 720) tl.timeScale(1.45);
  return tl;
}

// ---------------------------------------------------------------------------
// Per-frame DOM bindings: kinetic marquee + progress hairline
// ---------------------------------------------------------------------------
const marquee = { seg: 0, text: '', track: null, bar: null };

function setMarqueeText(text) {
  if (marquee.text === text) return;
  marquee.text = text;
  const track = marquee.track;
  const COPIES = 8;
  track.textContent = Array(COPIES).fill(text.toUpperCase()).join(' — ') + ' — ';
  marquee.seg = track.scrollWidth / COPIES;
}

function swapMarqueeText(text) {
  if (marquee.text === text) return;
  const track = marquee.track;
  gsap.to(track, {
    opacity: 0,
    duration: 0.35,
    onComplete: () => {
      setMarqueeText(text);
      gsap.to(track, { opacity: 1, duration: 0.6, delay: 0.25 });
    }
  });
}

function onGalleryFrame(info) {
  if (marquee.seg > 0 && gallery) {
    if (REDUCED_MOTION) {
      marquee.track.style.transform = `translate3d(${-marquee.seg}px,0,0)`;
    } else {
      const pxPerUnit = window.innerWidth / gallery.viewport.width;
      let px = (info.scroll * pxPerUnit * 0.3) % marquee.seg;
      px = ((px % marquee.seg) + marquee.seg) % marquee.seg;
      const skew = gsap.utils.clamp(-10, 10, -info.velocity * 7);
      marquee.track.style.transform = `translate3d(${-px - marquee.seg}px,0,0) skewX(${skew}deg)`;
    }
  }
  if (info.totalWidth > 0) {
    const frac = ((info.scroll / info.totalWidth) % 1 + 1) % 1;
    marquee.bar.style.transform = `scaleX(${frac})`;
  }
}

function applySettings() {
  const s = state.settings;
  document.title = s.siteTitle || 'Photo Port';
  $$('[data-site-title]').forEach((el) => (el.textContent = s.siteTitle || 'PHOTO PORT'));
  $('.about-name').textContent = s.photographer || s.siteTitle || '';
  $('.about-text').textContent = s.about || '';
  const links = $('.about-links');
  links.innerHTML = '';
  if (s.contactEmail) {
    const a = document.createElement('a');
    a.href = `mailto:${s.contactEmail}`;
    a.textContent = s.contactEmail;
    links.appendChild(a);
  }
  if (s.instagram) {
    const a = document.createElement('a');
    const handle = s.instagram.replace(/^@/, '');
    a.href = handle.startsWith('http') ? handle : `https://instagram.com/${handle}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = handle.startsWith('http') ? 'Instagram' : `@${handle}`;
    links.appendChild(a);
  }
}

// ---------------------------------------------------------------------------
// Animated text swaps (caption title slides per character, index rolls)
// ---------------------------------------------------------------------------
function animateText(el, text, { stagger = 0.018, rise = '0.7em' } = {}) {
  if (el.dataset.txt === text) return;
  el.dataset.txt = text;
  if (!isReady() || REDUCED_MOTION) {
    el.textContent = text;
    return;
  }
  el.innerHTML = '';
  const spans = [];
  const frag = document.createDocumentFragment();
  for (const ch of text) {
    const span = document.createElement('span');
    span.className = 'ch';
    span.textContent = ch === ' ' ? ' ' : ch;
    frag.appendChild(span);
    spans.push(span);
  }
  el.appendChild(frag);
  gsap.fromTo(
    spans,
    { y: rise, autoAlpha: 0 },
    { y: 0, autoAlpha: 1, duration: 0.65, ease: 'expo.out', stagger, overwrite: 'auto' }
  );
}

// ---------------------------------------------------------------------------
// Caption (bottom-left): current collection, centered photo, index
// ---------------------------------------------------------------------------
function updateCaption(item) {
  const folderName = state.folder ? state.folder.name : 'All Work';
  $('.caption-folder').textContent = folderName;
  if (!item) {
    animateText($('.caption-title'), '');
    $('.caption-index').textContent = '';
    return;
  }
  const idx = state.photos.findIndex((p) => p.id === item.photo.id);
  animateText($('.caption-title'), item.photo.title || 'Untitled');
  animateText(
    $('.caption-index'),
    `${String(idx + 1).padStart(2, '0')} / ${String(state.photos.length).padStart(2, '0')}`,
    { stagger: 0.035, rise: '1em' }
  );
}

// ---------------------------------------------------------------------------
// Collections overlay
// ---------------------------------------------------------------------------
function buildCollectionsList() {
  const list = $('.collections-list');
  const preview = $('.overlay-preview');
  list.innerHTML = '';

  const rows = [
    { id: null, name: 'All Work', count: countAllPhotos(), coverUrl: null },
    ...state.folders.map((f) => ({
      id: f.id,
      name: f.name,
      count: f.photoCount,
      coverUrl: f.coverUrl,
      folder: f
    }))
  ];

  rows.forEach((row, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML =
      `<span class="col-index">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="col-name">${escapeHtml(row.name)}</span>` +
      `<span class="col-count">${row.count}</span>`;
    btn.addEventListener('mouseenter', () => {
      if (row.coverUrl) {
        preview.src = row.coverUrl;
        preview.classList.add('visible');
      } else {
        preview.classList.remove('visible');
      }
    });
    btn.addEventListener('mouseleave', () => preview.classList.remove('visible'));
    btn.addEventListener('click', () => {
      closeOverlay($('#collections-overlay'));
      switchFolder(row.folder || null);
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function countAllPhotos() {
  return state.folders.reduce((sum, f) => sum + f.photoCount, 0) || state.photos.length;
}

async function switchFolder(folder) {
  const sameAll = !folder && !state.folder;
  const sameOne = folder && state.folder && folder.id === state.folder.id;
  if (state.switching || sameAll || sameOne || !gallery) return;
  state.switching = true;
  state.folder = folder;

  swapMarqueeText(marqueeName());
  await gallery.transitionOut();
  const res = await api.get(
    folder ? `/api/photos?folder=${encodeURIComponent(folder.slug)}` : '/api/photos'
  );
  state.photos = res.photos;
  if (state.photos.length) {
    const entries = await gallery.preload(state.photos);
    gallery.build(entries, { entered: true });
    gallery.transitionIn();
    updateCaption(gallery.centerItem);
  } else {
    gallery.clearStrip();
    updateCaption(null);
  }
  state.switching = false;
}

// ---------------------------------------------------------------------------
// Generic overlays (collections / about)
// ---------------------------------------------------------------------------
function openOverlay(el) {
  if (state.detailOpen || !isReady()) return;
  el.hidden = false;
  document.body.classList.add('ui-open');
  requestAnimationFrame(() => el.classList.add('open'));
}

function closeOverlay(el) {
  el.classList.remove('open');
  document.body.classList.remove('ui-open');
  const done = () => {
    el.hidden = true;
    el.removeEventListener('transitionend', done);
  };
  if (REDUCED_MOTION) done();
  else el.addEventListener('transitionend', done);
}

function initOverlays() {
  $('#nav-collections').addEventListener('click', () => openOverlay($('#collections-overlay')));
  $('#nav-about').addEventListener('click', () => openOverlay($('#about-overlay')));
  $$('.overlay-close').forEach((btn) =>
    btn.addEventListener('click', () => closeOverlay(btn.closest('.overlay')))
  );
  initDetail();
}

// ---------------------------------------------------------------------------
// Detail view: WebGL plane -> DOM FLIP into a focused frame
// ---------------------------------------------------------------------------
function detailTargetRect(photo) {
  const maxW = window.innerWidth * (window.innerWidth < 720 ? 0.92 : 0.84);
  const maxH = window.innerHeight * 0.72;
  const aspect = (photo.width || 3) / (photo.height || 2);
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return {
    left: (window.innerWidth - w) / 2,
    top: (window.innerHeight - h) / 2 - window.innerHeight * 0.02,
    width: w,
    height: h
  };
}

function setImgRect(img, rect) {
  img.style.left = `${rect.left}px`;
  img.style.top = `${rect.top}px`;
  img.style.width = `${rect.width}px`;
  img.style.height = `${rect.height}px`;
}

function fillDetailMeta(photo) {
  const idx = state.photos.findIndex((p) => p.id === photo.id);
  const folder = state.folders.find((f) => f.id === photo.folderId);
  $('.detail-folder').textContent = folder ? folder.name : state.settings.siteTitle;
  $('.detail-title').textContent = photo.title || 'Untitled';
  $('.detail-index').textContent = `${String(idx + 1).padStart(2, '0')} / ${String(
    state.photos.length
  ).padStart(2, '0')}`;
  $('.detail-img').alt = photo.alt || photo.title || 'Photograph';
}

/** Of all looped planes showing this photo, the one closest to screen center. */
function nearestItemFor(photoId) {
  const candidates = gallery.items.filter((i) => i.photo.id === photoId);
  if (!candidates.length) return gallery.centerItem;
  return candidates.reduce((best, item) =>
    Math.abs(gallery.wrappedX(item)) < Math.abs(gallery.wrappedX(best)) ? item : best
  );
}

async function openDetail(photo, clickedItem = null) {
  if (state.detailOpen || !gallery || !isReady()) return;
  state.detailOpen = true;
  gallery.locked = true;
  document.body.classList.add('ui-open', 'detail-open');

  const item = clickedItem || nearestItemFor(photo.id);
  gallery.locked = false;
  await gallery.centerOn(item);
  gallery.locked = true;

  state.detailIndex = state.photos.findIndex((p) => p.id === photo.id);
  const overlay = $('#detail-overlay');
  const img = $('.detail-img');
  const from = gallery.screenRect(item);
  const to = detailTargetRect(photo);

  img.src = photo.url;
  setImgRect(img, from);
  fillDetailMeta(photo);
  overlay.hidden = false;

  const dur = REDUCED_MOTION ? 0 : 0.75;
  gsap.to($('.detail-backdrop'), { opacity: 1, duration: dur, ease: 'power2.out' });
  gsap.to($('#gl'), { opacity: 0.16, duration: dur });
  gsap.to(img, { ...to, duration: dur, ease: 'expo.inOut' });
  gsap.fromTo(
    $('.detail-ui'),
    { opacity: 0, y: 14 },
    { opacity: 1, y: 0, duration: dur, delay: dur * 0.4, ease: 'power2.out' }
  );
}

async function navigateDetail(direction) {
  if (!state.detailOpen || state.photos.length < 2) return;
  const next =
    (state.detailIndex + direction + state.photos.length) % state.photos.length;
  state.detailIndex = next;
  const photo = state.photos[next];
  const img = $('.detail-img');
  const dur = REDUCED_MOTION ? 0 : 0.28;

  await gsap.to(img, { opacity: 0, duration: dur, ease: 'power1.in' });
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = photo.url;
  });
  setImgRect(img, detailTargetRect(photo));
  fillDetailMeta(photo);
  gsap.to(img, { opacity: 1, duration: dur, ease: 'power1.out' });
}

async function closeDetail() {
  if (!state.detailOpen || !gallery) return;
  const photo = state.photos[state.detailIndex];
  const overlay = $('#detail-overlay');
  const img = $('.detail-img');

  // Line the strip up behind the overlay so the photo returns to its plane.
  const item = nearestItemFor(photo.id);
  gallery.locked = false;
  await gallery.centerOn(item, 0);
  gallery.locked = true;
  const back = gallery.screenRect(item);

  const dur = REDUCED_MOTION ? 0 : 0.6;
  gsap.to($('.detail-ui'), { opacity: 0, y: 10, duration: dur * 0.4 });
  gsap.to($('.detail-backdrop'), { opacity: 0, duration: dur, ease: 'power2.in' });
  gsap.to($('#gl'), { opacity: 1, duration: dur });
  await gsap.to(img, { ...back, duration: dur, ease: 'expo.inOut' });

  overlay.hidden = true;
  img.style.opacity = '';
  state.detailOpen = false;
  gallery.locked = false;
  document.body.classList.remove('ui-open', 'detail-open');
  updateCaption(gallery.centerItem);
}

function initDetail() {
  $('.detail-close').addEventListener('click', closeDetail);
  $('.detail-backdrop').addEventListener('click', closeDetail);
  $('.detail-prev').addEventListener('click', () => navigateDetail(-1));
  $('.detail-next').addEventListener('click', () => navigateDetail(1));
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.detailOpen) closeDetail();
      else {
        const open = $$('.overlay.open')[0];
        if (open) closeOverlay(open);
      }
      return;
    }
    if (state.detailOpen) {
      if (e.key === 'ArrowLeft') navigateDetail(-1);
      if (e.key === 'ArrowRight') navigateDetail(1);
      return;
    }
    if (document.body.classList.contains('ui-open') || !gallery) return;
    if (e.key === 'ArrowLeft') gallery.nudge(-1);
    if (e.key === 'ArrowRight') gallery.nudge(1);
    if (e.key === 'Enter' && gallery.centerItem)
      openDetail(gallery.centerItem.photo, gallery.centerItem);
  });
}

// ---------------------------------------------------------------------------
// Magnetic buttons
// ---------------------------------------------------------------------------
function magnetize(el) {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    gsap.to(el, {
      x: gsap.utils.clamp(-24, 24, dx * 0.35),
      y: gsap.utils.clamp(-24, 24, dy * 0.35),
      duration: 0.35,
      ease: 'power2.out'
    });
  });
  el.addEventListener('pointerleave', () =>
    gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)' })
  );
}

function initMagnetics() {
  if (!FINE_POINTER || REDUCED_MOTION) return;
  $$('.nav-link, .brand, .overlay-close, .detail-close').forEach(magnetize);
}

// ---------------------------------------------------------------------------
// Custom cursor (with velocity squash/stretch) + film grain
// ---------------------------------------------------------------------------
function initCursor() {
  if (!FINE_POINTER) {
    $('#cursor').remove();
    return;
  }
  document.body.classList.add('has-cursor');
  const cursor = $('#cursor');
  const pos = { x: innerWidth / 2, y: innerHeight / 2 };
  const target = { ...pos };

  window.addEventListener('pointermove', (e) => {
    target.x = e.clientX;
    target.y = e.clientY;
  });
  gsap.ticker.add(() => {
    const vx = target.x - pos.x;
    const vy = target.y - pos.y;
    pos.x += vx * 0.2;
    pos.y += vy * 0.2;
    if (REDUCED_MOTION) {
      cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      return;
    }
    // Squash along the velocity vector, unrotated so the label stays level.
    const stretch = Math.min(0.22, Math.hypot(vx, vy) * 0.004);
    const ang = (Math.atan2(vy, vx) * 180) / Math.PI;
    cursor.style.transform =
      `translate(${pos.x}px, ${pos.y}px) rotate(${ang}deg) ` +
      `scale(${1 + stretch}, ${1 - stretch * 0.7}) rotate(${-ang}deg)`;
  });
  document.addEventListener('mouseover', (e) => {
    document.body.classList.toggle('link-hover', !!e.target.closest('a, button'));
  });
}

function initGrain() {
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(size, size);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = Math.random() * 255;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    data.data[i + 3] = 28;
  }
  ctx.putImageData(data, 0, 0);
  $('#grain').style.backgroundImage = `url(${canvas.toDataURL()})`;
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

boot().catch((err) => {
  console.error(err);
  const pre = $('#preloader');
  if (pre) {
    pre.innerHTML = `<div class="preloader-inner"><div class="preloader-title">Something went wrong</div><div class="preloader-count" style="font-size:1rem">${escapeHtml(
      err.message
    )}</div></div>`;
  }
});
