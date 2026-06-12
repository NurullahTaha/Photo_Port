import * as THREE from 'three';
import gsap from 'gsap';
import { vertexShader, fragmentShader } from './shaders.js';

const REDUCED_MOTION =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(pointer: fine)').matches;

const IDLE_DELAY = 6; // seconds without input before the strip auto-drifts

/**
 * Infinite horizontal WebGL photo strip.
 *
 * Photos live on a looping band; wheel / drag / keys scroll it with inertia.
 * On top of the base strip this adds: an intro fly-in (planes start as a
 * loose deck deep in Z and fan out into place), a rack-focus system (the
 * centered plane scales up and brightens), idle breathing, cursor ripples,
 * mouse-parallax on the camera, a floating dust layer, idle auto-drift, and
 * noise-dissolve twist transitions between collections.
 *
 * `calm` ramps to 1 while the detail overlay is open so every decorative
 * motion (bob, parallax) settles to zero and DOM FLIP rects stay accurate.
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
    this.parallax = new THREE.Vector2(0, 0); // damped camera offset target

    this.items = []; // { mesh, photo, baseX, width, hover, focus, ... }
    this.totalWidth = 0;
    this.planeH = 1;
    this.scroll = { current: 0, target: 0, last: 0, velocity: 0 };
    this.locked = false; // true while the detail overlay is open
    this.calm = 0; // 1 = all decorative motion suppressed
    this.time = 0;
    this.lastInput = 0;
    this._snapped = false;
    this.pointerSpeed = 0;
    this.hoveredItem = null;
    this.centerItem = null;

    this.onCenterChange = null; // (item) => void
    this.onItemClick = null; // (item) => void
    this.onHoverChange = null; // (item|null) => void
    this.onFrame = null; // ({ scroll, velocity, totalWidth, time }) => void

    this.geometry = new THREE.PlaneGeometry(1, 1, 24, 24);
    this.textureLoader = new THREE.TextureLoader();
    this.textureCache = new Map();

    // Reused per-frame scratch (no per-frame allocations).
    this._rayMeshes = [];
    this._frameInfo = { scroll: 0, velocity: 0, totalWidth: 0, time: 0 };

    this.clock = new THREE.Clock();
    this.resize();
    this.initParticles();
    this.bindEvents();
    this.renderer.setAnimationLoop(() => this.update());
  }

  markInput() {
    this.lastInput = this.time;
    this._snapped = false;
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
    if (this.items.length) this.layout();
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

  // --- dust layer ---------------------------------------------------------------
  initParticles() {
    const COUNT = 150;
    const positions = new Float32Array(COUNT * 3);
    this._dustBase = new Float32Array(COUNT * 3);
    this._dustPhase = new Float32Array(COUNT * 2);
    const vw = this.viewport.width;
    const vh = this.viewport.height;
    for (let i = 0; i < COUNT; i++) {
      this._dustBase[i * 3] = (Math.random() - 0.5) * vw * 1.5;
      this._dustBase[i * 3 + 1] = (Math.random() - 0.5) * vh * 1.1;
      this._dustBase[i * 3 + 2] = 2.5 + Math.random() * 4;
      this._dustPhase[i * 2] = Math.random() * Math.PI * 2;
      this._dustPhase[i * 2 + 1] = Math.random() * Math.PI * 2;
      positions[i * 3] = this._dustBase[i * 3];
      positions[i * 3 + 1] = this._dustBase[i * 3 + 1];
      positions[i * 3 + 2] = this._dustBase[i * 3 + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.035,
        color: 0xd6c9a8,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
      })
    );
    this.scene.add(this.dust);
    gsap.to(this.dust.material, { opacity: 0.35, duration: 2, delay: 1.5 });
  }

  updateParticles(dt) {
    if (!this.dust || REDUCED_MOTION) return;
    const pos = this.dust.geometry.attributes.position;
    const arr = pos.array;
    const t = this.time;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3] = this._dustBase[i * 3] + Math.cos(t * 0.18 + this._dustPhase[i * 2]) * 0.22;
      arr[i * 3 + 1] =
        this._dustBase[i * 3 + 1] + Math.sin(t * 0.26 + this._dustPhase[i * 2 + 1]) * 0.3;
    }
    pos.needsUpdate = true;
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
   * always has enough content to wrap seamlessly. `entered` controls whether
   * planes start in place (collection switches handle their own reveal) or
   * deep in Z as the intro deck (introP = 0).
   */
  build(entries, { entered = true } = {}) {
    this.clearStrip();
    if (!entries.length) return;

    let loop = [...entries];
    while (loop.length < 6) loop = loop.concat(entries);

    this.planeH = this.viewport.height * (window.innerWidth < 720 ? 0.42 : 0.56);
    const gap = this.viewport.height * 0.085;

    let x = 0;
    for (const { photo, texture } of loop) {
      const img = texture.image;
      const aspect = THREE.MathUtils.clamp(
        (photo.width || img.width || 1) / (photo.height || img.height || 1),
        0.55,
        1.9
      );
      const w = this.planeH * aspect;
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        uniforms: {
          uMap: { value: texture },
          uImageSize: { value: new THREE.Vector2(img.width, img.height) },
          uPlaneSize: { value: new THREE.Vector2(w, this.planeH) },
          uHover: { value: 0 },
          uFocus: { value: 0 },
          uVel: { value: 0 },
          uAlpha: { value: 1 },
          uTime: { value: 0 },
          uScreenX: { value: 0 },
          uRipple: { value: new THREE.Vector3(0.5, 0.5, 0) },
          uOut: { value: 0 },
          uDir: { value: 1 }
        }
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.scale.set(w, this.planeH, 1);
      const item = {
        mesh,
        photo,
        baseX: x + w / 2,
        width: w,
        hover: 0,
        focus: 0,
        ripple: 0,
        tiltX: 0,
        tiltY: 0,
        hitUv: null,
        phase: Math.random() * Math.PI * 2,
        // Intro deck pose: loosely stacked near center, deep in Z.
        stackX: (Math.random() - 0.5) * this.viewport.width * 0.18,
        stackZ: -16 - Math.random() * 14,
        stackRot: (Math.random() - 0.5) * 0.35,
        introP: entered || REDUCED_MOTION ? 1 : 0
      };
      mesh.userData.item = item;
      this.scene.add(mesh);
      this.items.push(item);
      x += w + gap;
    }
    this.totalWidth = x;
    this.scroll.current = this.scroll.target = this.scroll.last = 0;
    this.positionItems();
  }

  layout() {
    if (!this.items.length) return;
    this.planeH = this.viewport.height * (window.innerWidth < 720 ? 0.42 : 0.56);
    const gap = this.viewport.height * 0.085;
    let x = 0;
    for (const item of this.items) {
      const aspect = item.mesh.material.uniforms.uPlaneSize.value.x /
        item.mesh.material.uniforms.uPlaneSize.value.y;
      const w = this.planeH * aspect;
      item.width = w;
      item.baseX = x + w / 2;
      item.mesh.material.uniforms.uPlaneSize.value.set(w, this.planeH);
      x += w + gap;
    }
    this.totalWidth = x;
    this.positionItems();
  }

  wrappedX(item) {
    const t = this.totalWidth;
    return ((((item.baseX - this.scroll.current) % t) + t * 1.5) % t) - t * 0.5;
  }

  /** Place every plane: strip position blended with its intro deck pose. */
  positionItems() {
    const motion = REDUCED_MOTION ? 0 : 1 - this.calm;
    for (const item of this.items) {
      const stripX = this.wrappedX(item);
      const p = item.introP;
      const x = stripX * p + item.stackX * (1 - p);
      const bob = Math.sin(this.time * 0.7 + item.phase) * 0.045 * motion;
      const arcZ = -(x * x) * 0.014;
      const recede = -(1 - item.focus) * 0.32;
      item.mesh.position.x = x;
      item.mesh.position.y = bob * p;
      item.mesh.position.z = (arcZ + recede) * p + item.stackZ * (1 - p);
      item.mesh.rotation.x = item.tiltX * p;
      item.mesh.rotation.y = (-x * 0.018 + item.tiltY) * p;
      item.mesh.rotation.z = item.stackRot * (1 - p);
      const f = 1 + item.focus * 0.06;
      item.mesh.scale.set(item.width * f, this.planeH * f, 1);
      item.mesh.visible =
        p < 0.999 || Math.abs(x) < this.viewport.width * 0.85 + item.width;
    }
  }

  // --- input -------------------------------------------------------------------
  bindEvents() {
    window.addEventListener('resize', () => this.resize());

    window.addEventListener(
      'wheel',
      (e) => {
        this.markInput();
        if (this.locked || this.uiOpen()) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        this.scroll.target += delta * 0.0035;
      },
      { passive: true }
    );

    let dragging = false;
    let dragStart = 0;
    let dragScroll = 0;
    let moved = 0;
    let lastPX = 0;
    let lastPY = 0;

    this.canvas.addEventListener('pointerdown', (e) => {
      this.markInput();
      if (this.locked || this.uiOpen()) return;
      dragging = true;
      moved = 0;
      dragStart = e.clientX;
      dragScroll = this.scroll.target;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      this.markInput();
      this.pointerSpeed = Math.min(
        1.5,
        Math.hypot(e.clientX - lastPX, e.clientY - lastPY) * 0.02
      );
      lastPX = e.clientX;
      lastPY = e.clientY;
      this.pointer.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      if (!dragging) return;
      const dx = e.clientX - dragStart;
      moved = Math.max(moved, Math.abs(dx));
      this.scroll.target = dragScroll - dx * (this.viewport.width / window.innerWidth) * 1.4;
    });
    const endDrag = () => {
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
    this.markInput();
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
    const cy = item.mesh.position.y;
    const pxPerUnitX = window.innerWidth / vw;
    const pxPerUnitY = window.innerHeight / vh;
    return {
      left: (cx - w / 2 + vw / 2) * pxPerUnitX,
      top: (-cy - h / 2 + vh / 2) * pxPerUnitY,
      width: w * pxPerUnitX,
      height: h * pxPerUnitY
    };
  }

  // --- entrances & transitions ---------------------------------------------------
  /** Intro: the deck fans out from deep Z into the strip. Returns a timeline. */
  introPlay() {
    const tl = gsap.timeline();
    if (REDUCED_MOTION) {
      this.items.forEach((i) => (i.introP = 1));
      return tl;
    }
    const ordered = [...this.items].sort(
      (a, b) => Math.abs(this.wrappedX(a)) - Math.abs(this.wrappedX(b))
    );
    ordered.forEach((item, i) => {
      tl.to(
        item,
        { introP: 1, duration: 1.7, ease: 'expo.out' },
        Math.min(i, 22) * 0.055
      );
    });
    return tl;
  }

  /** Twist + noise-dissolve the current strip away. */
  transitionOut() {
    if (!this.items.length) return Promise.resolve();
    if (REDUCED_MOTION) {
      this.items.forEach((i) => (i.mesh.material.uniforms.uOut.value = 1));
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const tl = gsap.timeline({ onComplete: resolve });
      for (const item of this.items) {
        const u = item.mesh.material.uniforms;
        u.uDir.value = 1;
        const norm = (this.wrappedX(item) / this.viewport.width + 1) * 0.5;
        tl.to(
          u.uOut,
          { value: 1, duration: 0.65, ease: 'power2.in' },
          THREE.MathUtils.clamp(norm, 0, 1) * 0.3
        );
      }
    });
  }

  /** Twist the freshly built strip in (call right after build()). */
  transitionIn() {
    for (const item of this.items) {
      const u = item.mesh.material.uniforms;
      u.uOut.value = REDUCED_MOTION ? 0 : 1;
      u.uDir.value = -1;
    }
    if (REDUCED_MOTION) return gsap.timeline();
    const tl = gsap.timeline();
    for (const item of this.items) {
      const norm = (this.wrappedX(item) / this.viewport.width + 1) * 0.5;
      tl.to(
        item.mesh.material.uniforms.uOut,
        { value: 0, duration: 0.85, ease: 'expo.out' },
        0.1 + THREE.MathUtils.clamp(norm, 0, 1) * 0.35
      );
    }
    return tl;
  }

  // --- frame loop ----------------------------------------------------------------
  update() {
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    this.time += dt;

    // Everything decorative settles while the detail overlay is open.
    this.calm = THREE.MathUtils.damp(this.calm, this.locked ? 1 : 0, 4, dt);

    // Idle drift: after a quiet spell the strip wanders on its own.
    if (
      !REDUCED_MOTION &&
      !this.locked &&
      !this.uiOpen() &&
      this.items.length &&
      this.time - this.lastInput > IDLE_DELAY
    ) {
      this.scroll.target += dt * this.viewport.width * 0.022;
    }

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

    // Mouse parallax on the camera (fine pointers only).
    const wantParallax =
      FINE_POINTER && !REDUCED_MOTION && this.pointer.x > -1.5 ? 1 - this.calm : 0;
    this.parallax.x = THREE.MathUtils.damp(
      this.parallax.x,
      this.pointer.x * 0.28 * wantParallax,
      3.5,
      dt
    );
    this.parallax.y = THREE.MathUtils.damp(
      this.parallax.y,
      this.pointer.y * 0.16 * wantParallax,
      3.5,
      dt
    );
    this.camera.position.x = this.parallax.x;
    this.camera.position.y = this.parallax.y;
    this.camera.lookAt(0, 0, 0);

    this.pointerSpeed *= Math.exp(-4 * dt);
    this.updateParticles(dt);

    if (this.items.length) {
      // Hover raycast (skip while UI is open).
      let hovered = null;
      let hitUv = null;
      if (!this.locked && !this.uiOpen() && this.pointer.x > -1.5) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        this._rayMeshes.length = 0;
        for (const item of this.items) {
          if (item.mesh.visible) this._rayMeshes.push(item.mesh);
        }
        const hits = this.raycaster.intersectObjects(this._rayMeshes, false);
        if (hits.length) {
          hovered = hits[0].object.userData.item;
          hitUv = hits[0].uv;
          hovered.hitUv = hitUv;
        }
      }
      if (hovered !== this.hoveredItem) {
        this.hoveredItem = hovered;
        if (this.onHoverChange) this.onHoverChange(hovered);
      }

      let nearest = null;
      let nearestDist = Infinity;
      const halfView = this.viewport.width * 0.5;
      for (const item of this.items) {
        const u = item.mesh.material.uniforms;
        const x = item.mesh.position.x;
        u.uVel.value = vel;
        u.uTime.value = this.time;
        u.uScreenX.value = THREE.MathUtils.clamp(x / halfView, -1, 1);

        const targetHover = item === this.hoveredItem ? 1 : 0;
        item.hover = THREE.MathUtils.damp(item.hover, targetHover, 8, dt);
        u.uHover.value = item.hover;

        // Tactile tilt toward the cursor position on the hovered plane.
        const wantTilt =
          !REDUCED_MOTION && item === this.hoveredItem && item.hitUv ? 1 : 0;
        const tiltXT = wantTilt ? (item.hitUv.y - 0.5) * 0.12 : 0;
        const tiltYT = wantTilt ? (item.hitUv.x - 0.5) * 0.16 : 0;
        item.tiltX = THREE.MathUtils.damp(item.tiltX, tiltXT, 7, dt);
        item.tiltY = THREE.MathUtils.damp(item.tiltY, tiltYT, 7, dt);

        // Rack focus: continuous falloff from screen center.
        const focusTarget =
          1 - THREE.MathUtils.clamp(Math.abs(x) / (item.width * 1.35), 0, 1);
        item.focus = THREE.MathUtils.damp(item.focus, focusTarget, 6, dt);
        u.uFocus.value = item.focus;

        // Cursor ripple: position follows the hit uv, strength decays.
        if (item === this.hoveredItem && hitUv && !REDUCED_MOTION) {
          u.uRipple.value.x = hitUv.x;
          u.uRipple.value.y = hitUv.y;
          item.ripple = Math.min(1, item.ripple + this.pointerSpeed * 0.5);
        }
        item.ripple *= Math.exp(-2.2 * dt);
        u.uRipple.value.z = item.ripple;

        const d = Math.abs(x);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = item;
        }
      }
      if (nearest !== this.centerItem) {
        this.centerItem = nearest;
        if (this.onCenterChange) this.onCenterChange(nearest);
      }

      // Once a scroll settles, ease the nearest photo onto dead center.
      if (
        !REDUCED_MOTION &&
        !this._snapped &&
        !this.locked &&
        !this.uiOpen() &&
        this.centerItem &&
        this.time - this.lastInput > 0.9 &&
        Math.abs(this.scroll.velocity) < 0.05 &&
        Math.abs(this.scroll.target - this.scroll.current) < this.viewport.width * 0.02
      ) {
        this.scroll.target += this.centerItem.mesh.position.x;
        this._snapped = true;
      }

      this.positionItems();
    }

    if (this.onFrame) {
      this._frameInfo.scroll = this.scroll.current;
      this._frameInfo.velocity = vel;
      this._frameInfo.totalWidth = this.totalWidth;
      this._frameInfo.time = this.time;
      this.onFrame(this._frameInfo);
    }

    this.renderer.render(this.scene, this.camera);
  }

  nudge(direction) {
    this.markInput();
    if (this.locked || !this.items.length) return;
    const step = this.viewport.width * 0.28;
    this.scroll.target += direction * step;
  }
}

export { REDUCED_MOTION, FINE_POINTER };
