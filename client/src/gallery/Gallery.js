import * as THREE from 'three';
import gsap from 'gsap';
import { vertexShader, fragmentShader } from './shaders.js';

const REDUCED_MOTION =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Infinite horizontal WebGL photo strip.
 * Photos are laid out on a looping band; wheel / drag / keys scroll it with
 * inertia, velocity bends the planes, hovering lifts them, clicking centers
 * the photo (the detail overlay then takes over in DOM space).
 */
export class Gallery {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.z = 10;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-2, -2);

    this.items = []; // { mesh, photo, baseX, width }
    this.totalWidth = 0;
    this.scroll = { current: 0, target: 0, last: 0, velocity: 0 };
    this.locked = false; // true while the detail overlay is open
    this.hoveredItem = null;
    this.centerItem = null;

    this.onCenterChange = null; // (item) => void
    this.onItemClick = null; // (item) => void
    this.onHoverChange = null; // (item|null) => void

    this.geometry = new THREE.PlaneGeometry(1, 1, 24, 24);
    this.textureLoader = new THREE.TextureLoader();
    this.textureCache = new Map();

    this.clock = new THREE.Clock();
    this.resize();
    this.bindEvents();
    this.renderer.setAnimationLoop(() => this.update());
  }

  // --- sizing ---------------------------------------------------------------
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const fovRad = (this.camera.fov * Math.PI) / 180;
    this.viewport = {
      height: 2 * Math.tan(fovRad / 2) * this.camera.position.z,
      width: 2 * Math.tan(fovRad / 2) * this.camera.position.z * this.camera.aspect
    };
    if (this.items.length) this.layout(false);
  }

  // --- textures ---------------------------------------------------------------
  loadTexture(url) {
    if (this.textureCache.has(url)) return Promise.resolve(this.textureCache.get(url));
    return new Promise((resolve) => {
      this.textureLoader.load(
        url,
        (tex) => {
          tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
          this.textureCache.set(url, tex);
          resolve(tex);
        },
        undefined,
        () => resolve(null) // tolerate a broken file; plane is skipped
      );
    });
  }

  async preload(photos, onProgress) {
    let done = 0;
    const textures = await Promise.all(
      photos.map(async (photo) => {
        const tex = await this.loadTexture(photo.url);
        done += 1;
        if (onProgress) onProgress(done / photos.length);
        return tex;
      })
    );
    return photos
      .map((photo, i) => ({ photo, texture: textures[i] }))
      .filter((e) => e.texture);
  }

  // --- strip construction -----------------------------------------------------
  clearStrip() {
    for (const item of this.items) {
      this.scene.remove(item.mesh);
      item.mesh.material.dispose();
    }
    this.items = [];
    this.hoveredItem = null;
    this.centerItem = null;
  }

  /**
   * Build planes for [{photo, texture}] entries. Repeats the set so the loop
   * always has enough content to wrap seamlessly.
   */
  build(entries) {
    this.clearStrip();
    if (!entries.length) return;

    let loop = [...entries];
    const minCount = Math.max(6, entries.length);
    while (loop.length < minCount || loop.length < 6) loop = loop.concat(entries);

    const planeH = this.viewport.height * (window.innerWidth < 720 ? 0.42 : 0.56);
    const gap = this.viewport.height * 0.085;

    let x = 0;
    for (const { photo, texture } of loop) {
      const img = texture.image;
      const aspect = THREE.MathUtils.clamp(
        (photo.width || img.width || 1) / (photo.height || img.height || 1),
        0.55,
        1.9
      );
      const w = planeH * aspect;
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        uniforms: {
          uMap: { value: texture },
          uImageSize: { value: new THREE.Vector2(img.width, img.height) },
          uPlaneSize: { value: new THREE.Vector2(w, planeH) },
          uHover: { value: 0 },
          uVel: { value: 0 },
          uAlpha: { value: 1 },
          uReveal: { value: REDUCED_MOTION ? 1 : 0 }
        }
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.scale.set(w, planeH, 1);
      const item = { mesh, photo, baseX: x + w / 2, width: w, hover: 0 };
      mesh.userData.item = item;
      this.scene.add(mesh);
      this.items.push(item);
      x += w + gap;
    }
    this.totalWidth = x;
    this.scroll.current = this.scroll.target = this.scroll.last = 0;
    this.layout(true);
  }

  layout(reposition) {
    if (!this.items.length) return;
    const planeH = this.viewport.height * (window.innerWidth < 720 ? 0.42 : 0.56);
    const gap = this.viewport.height * 0.085;
    let x = 0;
    for (const item of this.items) {
      const aspect = item.mesh.scale.x / item.mesh.scale.y;
      const w = planeH * aspect;
      item.width = w;
      item.baseX = x + w / 2;
      item.mesh.scale.set(w, planeH, 1);
      item.mesh.material.uniforms.uPlaneSize.value.set(w, planeH);
      x += w + gap;
    }
    this.totalWidth = x;
    if (reposition) this.positionItems();
  }

  wrappedX(item) {
    const t = this.totalWidth;
    return ((((item.baseX - this.scroll.current) % t) + t * 1.5) % t) - t * 0.5;
  }

  positionItems() {
    for (const item of this.items) {
      const x = this.wrappedX(item);
      item.mesh.position.x = x;
      item.mesh.position.z = -(x * x) * 0.014;
      item.mesh.rotation.y = -x * 0.018;
      item.mesh.visible = Math.abs(x) < this.viewport.width * 0.85 + item.width;
    }
  }

  // --- input -------------------------------------------------------------------
  bindEvents() {
    window.addEventListener('resize', () => this.resize());

    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked || this.uiOpen()) return;
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
        this.scroll.target += delta * 0.0035;
      },
      { passive: true }
    );

    let dragging = false;
    let dragStart = 0;
    let dragScroll = 0;
    let moved = 0;

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.locked || this.uiOpen()) return;
      dragging = true;
      moved = 0;
      dragStart = e.clientX;
      dragScroll = this.scroll.target;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      this.pointer.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      if (!dragging) return;
      const dx = e.clientX - dragStart;
      moved = Math.max(moved, Math.abs(dx));
      this.scroll.target = dragScroll - dx * (this.viewport.width / window.innerWidth) * 1.4;
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      if (moved < 6 && !this.locked && !this.uiOpen()) this.handleClick();
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', () => (dragging = false));
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.set(-2, -2);
    });
  }

  uiOpen() {
    return document.body.classList.contains('ui-open');
  }

  handleClick() {
    if (this.hoveredItem && this.onItemClick) this.onItemClick(this.hoveredItem);
  }

  /** Scroll so the given item lands at screen center; resolves when settled. */
  centerOn(item, duration = 0.55) {
    const x = this.wrappedX(item);
    const target = this.scroll.current + x;
    this.scroll.target = target;
    return new Promise((resolve) => {
      if (REDUCED_MOTION || duration === 0) {
        this.scroll.current = target;
        this.positionItems();
        resolve();
        return;
      }
      gsap.to(this.scroll, {
        current: target,
        duration,
        ease: 'power3.out',
        onUpdate: () => {
          this.scroll.target = this.scroll.current;
          this.positionItems();
        },
        onComplete: resolve
      });
    });
  }

  /** Screen-space rect (px) of an item's plane, for DOM FLIP transitions. */
  screenRect(item) {
    const { width: vw, height: vh } = this.viewport;
    const w = item.mesh.scale.x;
    const h = item.mesh.scale.y;
    const cx = item.mesh.position.x;
    const pxPerUnitX = window.innerWidth / vw;
    const pxPerUnitY = window.innerHeight / vh;
    return {
      left: (cx - w / 2 + vw / 2) * pxPerUnitX,
      top: (0 - h / 2 + vh / 2) * pxPerUnitY,
      width: w * pxPerUnitX,
      height: h * pxPerUnitY
    };
  }

  /** Stagger-reveal all planes (used after preloader and folder switches). */
  reveal() {
    const tl = gsap.timeline();
    this.positionItems();
    const visible = this.items.filter((i) => i.mesh.visible);
    visible.sort((a, b) => Math.abs(this.wrappedX(a)) - Math.abs(this.wrappedX(b)));
    visible.forEach((item, i) => {
      tl.to(
        item.mesh.material.uniforms.uReveal,
        { value: 1, duration: REDUCED_MOTION ? 0 : 1.1, ease: 'expo.out' },
        i * 0.07
      );
    });
    for (const item of this.items) {
      if (!visible.includes(item)) item.mesh.material.uniforms.uReveal.value = 1;
    }
    return tl;
  }

  conceal() {
    if (REDUCED_MOTION) {
      for (const item of this.items) item.mesh.material.uniforms.uReveal.value = 0;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const tl = gsap.timeline({ onComplete: resolve });
      this.items.forEach((item, i) => {
        tl.to(
          item.mesh.material.uniforms.uReveal,
          { value: 0, duration: 0.5, ease: 'expo.in' },
          (i % 7) * 0.03
        );
      });
    });
  }

  // --- frame loop ----------------------------------------------------------------
  update() {
    const dt = Math.min(this.clock.getDelta(), 1 / 30);

    if (!this.locked) {
      this.scroll.current = REDUCED_MOTION
        ? this.scroll.target
        : THREE.MathUtils.damp(this.scroll.current, this.scroll.target, 5.2, dt);
    }
    const rawVel = (this.scroll.current - this.scroll.last) / Math.max(dt, 1e-4);
    this.scroll.last = this.scroll.current;
    this.scroll.velocity = THREE.MathUtils.damp(
      this.scroll.velocity,
      THREE.MathUtils.clamp(rawVel * 0.06, -1.2, 1.2),
      6,
      dt
    );
    const vel = REDUCED_MOTION ? 0 : this.scroll.velocity;

    if (this.items.length) {
      this.positionItems();

      // Hover raycast (skip while dragging fast or UI open)
      let hovered = null;
      if (!this.locked && !this.uiOpen() && this.pointer.x > -1.5) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(
          this.items.filter((i) => i.mesh.visible).map((i) => i.mesh)
        );
        hovered = hits.length ? hits[0].object.userData.item : null;
      }
      if (hovered !== this.hoveredItem) {
        this.hoveredItem = hovered;
        if (this.onHoverChange) this.onHoverChange(hovered);
      }

      let nearest = null;
      let nearestDist = Infinity;
      for (const item of this.items) {
        const u = item.mesh.material.uniforms;
        u.uVel.value = vel;
        const targetHover = item === this.hoveredItem ? 1 : 0;
        item.hover = THREE.MathUtils.damp(item.hover, targetHover, 8, dt);
        u.uHover.value = item.hover;
        const d = Math.abs(item.mesh.position.x);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = item;
        }
      }
      if (nearest !== this.centerItem) {
        this.centerItem = nearest;
        if (this.onCenterChange) this.onCenterChange(nearest);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  nudge(direction) {
    if (this.locked || !this.items.length) return;
    const step = this.viewport.width * 0.28;
    this.scroll.target += direction * step;
  }
}

export { REDUCED_MOTION };
