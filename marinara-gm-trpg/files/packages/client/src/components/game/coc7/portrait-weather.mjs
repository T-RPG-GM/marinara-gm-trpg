/* global document, DOMMatrix, HTMLElement, customElements, ResizeObserver, window */

const tag = 'coc7-portrait-weather';
const sprites = new Map();
const TAU = Math.PI * 2;
const wrap = (value) => value - Math.floor(value);
const ease = (value) => value * value * (3 - 2 * value);
const between = (low, high, value) => ease(Math.max(0,Math.min(1,(value - low) / (high - low))));

function randomFor(seed) {
  return () => {
    seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function sprite(key, width, height, paint) {
  if (!sprites.has(key)) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    paint(surface.getContext('2d'));
    sprites.set(key,surface);
  }
  return sprites.get(key);
}

// Value noise that repeats every 1.0 in both directions, so textures can scroll without seams.
function tileNoise(seed, cells) {
  const random = randomFor(seed);
  const lattice = Array.from({ length:cells * cells },random);
  return (x,y) => {
    const gx = wrap(x) * cells;
    const gy = wrap(y) * cells;
    const left = Math.floor(gx);
    const top = Math.floor(gy);
    const right = (left + 1) % cells;
    const bottom = (top + 1) % cells;
    const mixX = ease(gx - left);
    const mixY = ease(gy - top);
    const upper = lattice[top * cells + left] + mixX * (lattice[top * cells + right] - lattice[top * cells + left]);
    const lower = lattice[bottom * cells + left] + mixX * (lattice[bottom * cells + right] - lattice[bottom * cells + left]);
    return upper + mixY * (lower - upper);
  };
}

function fractalNoise(seed) {
  const octaves = [[4,.5],[8,.27],[16,.15],[32,.08]].map(([cells,weight],index) => [tileNoise(seed + index * 7919,cells),weight]);
  return (x,y) => octaves.reduce((sum,[sample,weight]) => sum + sample(x,y) * weight,0);
}

/* ---------------------------------------------------------------- snow */

// One soft flake: a white core with a tight, faint shadow under it, so it reads over bright photos
// without turning into a drawn dot. Nearer flakes are a little out of focus.
function snowFlake(blur) {
  return sprite(`snow-${blur}`,32,32,(ink) => {
    ink.filter = `blur(${blur}px)`;
    const shade = ink.createRadialGradient(16,17,0,16,17,9);
    shade.addColorStop(0,'rgb(70 84 102 / 36%)');
    shade.addColorStop(.6,'rgb(70 84 102 / 16%)');
    shade.addColorStop(1,'rgb(70 84 102 / 0%)');
    ink.fillStyle = shade;
    ink.beginPath();
    ink.arc(16,17,9,0,TAU);
    ink.fill();
    const core = ink.createRadialGradient(16,16,0,16,16,7);
    core.addColorStop(0,'rgb(255 255 255 / 100%)');
    core.addColorStop(.55,'rgb(250 252 255 / 85%)');
    core.addColorStop(1,'rgb(245 249 255 / 0%)');
    ink.fillStyle = core;
    ink.beginPath();
    ink.arc(16,16,7,0,TAU);
    ink.fill();
  });
}

// Integral of a slow, gusty wind speed, so horizontal drift stays continuous while the wind changes.
const gustDrift = (time) => .16 * time - 2.38 * Math.cos(.21 * time) - .57 * Math.cos(.53 * time + 1.3) - .18 * Math.cos(1.1 * time + .4);

function snowfall() {
  const random = randomFor(25571);
  const range = (low, high) => low + random() * (high - low);
  const layer = (count, settings) => Array.from({ length:count },() => ({
    x:random(), y:random(), phase:random() * TAU, phase2:random() * TAU, flutter:range(.6,1.3), ...settings(),
  }));
  // Many small flakes far away, fewer and softer ones up close; all drift with the same wind.
  const flakes = [
    ...layer(150,() => ({ size:range(1,1.7), pace:range(.035,.055), alpha:range(.5,.7), swing:range(1,2.5), drift:.05, stretch:1.1, image:snowFlake(0) })),
    ...layer(70,() => ({ size:range(1.8,3), pace:range(.06,.09), alpha:range(.7,.9), swing:range(2.5,6), drift:.08, stretch:1.2, image:snowFlake(0) })),
    ...layer(16,() => ({ size:range(3.5,5.5), pace:range(.11,.16), alpha:range(.55,.75), swing:range(5,10), drift:.12, stretch:1.35, image:snowFlake(1.2) })),
  ];
  return (ink,width,height,time) => {
    const scale = Math.max(.8,Math.min(1.5,height / 500));
    const drift = gustDrift(time);
    for (const item of flakes) {
      const across = item.size * scale * 2.3;
      const along = across * item.stretch;
      const pad = along + 8;
      const motion = time * item.flutter + item.phase;
      const sway = (Math.sin(motion) + .3 * Math.sin(motion * 2.3 + item.phase2)) * item.swing * scale;
      const x = wrap(item.x + drift * item.drift) * (width + pad * 2) - pad + sway;
      const y = wrap(item.y + time * item.pace + .008 * Math.sin(motion * 1.7)) * (height + pad * 2) - pad;
      ink.globalAlpha = item.alpha;
      ink.drawImage(item.image,x - across / 2,y - along / 2,across,along);
    }
  };
}

/* ---------------------------------------------------------------- rain */

// Falling drops photograph as thin motion-blurred streaks with a brighter leading end.
function rainStreak(near) {
  return sprite(near ? 'rain-near' : 'rain-far',16,128,(ink) => {
    const trail = ink.createLinearGradient(0,0,0,128);
    trail.addColorStop(0,'rgb(205 215 224 / 0%)');
    trail.addColorStop(.45,'rgb(196 208 218 / 30%)');
    trail.addColorStop(.86,'rgb(226 234 241 / 72%)');
    trail.addColorStop(.96,'rgb(248 251 253 / 85%)');
    trail.addColorStop(1,'rgb(248 251 253 / 0%)');
    ink.filter = near ? 'blur(1.6px)' : 'blur(.4px)';
    // A faint dark edge keeps streaks visible over bright photos; the light core shows over dark ones.
    const edge = ink.createLinearGradient(0,0,0,128);
    edge.addColorStop(0,'rgb(58 70 82 / 0%)');
    edge.addColorStop(.6,'rgb(58 70 82 / 16%)');
    edge.addColorStop(.95,'rgb(58 70 82 / 26%)');
    edge.addColorStop(1,'rgb(58 70 82 / 0%)');
    ink.fillStyle = edge;
    ink.beginPath();
    ink.ellipse(8,64,near ? 6.5 : 5,63,0,0,TAU);
    ink.fill();
    ink.fillStyle = trail;
    ink.beginPath();
    ink.ellipse(8,64,near ? 4.5 : 3,62,0,0,TAU);
    ink.fill();
  });
}

function rainfall() {
  const random = randomFor(82319);
  const range = (low, high) => low + random() * (high - low);
  const drop = (layer) => ({ lane:random(), phase:random(), ...layer() });
  const drops = [
    ...Array.from({ length:150 },() => drop(() => ({ length:range(18,30), thickness:range(.9,1.2), alpha:range(.3,.48), pace:range(1.3,1.7), image:rainStreak(false) }))),
    ...Array.from({ length:85 },() => drop(() => ({ length:range(26,46), thickness:range(1.2,1.7), alpha:range(.5,.74), pace:range(1.9,2.5), image:rainStreak(false) }))),
    ...Array.from({ length:12 },() => drop(() => ({ length:range(70,120), thickness:range(3,4.4), alpha:range(.22,.34), pace:range(2.9,3.7), image:rainStreak(true) }))),
  ];
  return (ink,width,height,time) => {
    const scale = Math.max(.76,Math.min(1.4,height / 470));
    ink.globalAlpha = 1;
    ink.fillStyle = 'rgb(46 58 70 / 8%)';
    ink.fillRect(0,0,width,height);

    // Every drop is laid out in a frame tilted by the wind, which sways slowly.
    const angle = .15 + .05 * Math.sin(time * .31) + .02 * Math.sin(time * .87);
    const span = Math.hypot(width,height);
    const padding = 120 * scale;
    ink.save();
    ink.translate(width / 2,height / 2);
    ink.rotate(angle);
    for (const item of drops) {
      const fall = item.phase + time * item.pace * (500 / (span + padding * 2)) * scale;
      // Choose a new lane only after the full streak has left the photo.
      const x = (wrap(item.lane + Math.floor(fall) * .61803398875) - .5) * span;
      const y = wrap(fall) * (span + padding * 2) - span / 2 - padding;
      const length = item.length * scale;
      ink.globalAlpha = item.alpha;
      ink.drawImage(item.image,x - item.thickness / 2,y - length,item.thickness,length);
    }
    ink.restore();

    ink.globalAlpha = 1;
    const mist = ink.createLinearGradient(0,height * .6,0,height);
    mist.addColorStop(0,'rgb(196 206 216 / 0%)');
    mist.addColorStop(1,'rgb(196 206 216 / 14%)');
    ink.fillStyle = mist;
    ink.fillRect(0,height * .6,width,height * .4);
  };
}

/* ---------------------------------------------------------------- fog */

// Horizontally seamless fog sheets: domain-warped fractal noise shaped by a vertical density profile.
function fogSheet(variant, profile) {
  const width = 320;
  const height = 160;
  return sprite(`fog-${variant}`,width,height,(ink) => {
    const shape = fractalNoise(32839 + variant * 8719);
    const warp = fractalNoise(9157 + variant * 4243);
    const pixels = ink.createImageData(width,height);
    for (let row = 0; row < height; row++) {
      const y = row / height;
      const vertical = profile(y);
      for (let column = 0; column < width; column++) {
        const x = column / width;
        // Sampling y at a higher rate than x keeps the wisps wide and low, the way drifting fog lies in bands.
        const bend = warp(x,y * 1.4) - .5;
        const density = shape(x + bend * .3,y * 1.4 + bend * .25);
        const wisp = between(.28,.86,density) ** 1.25;
        const offset = (row * width + column) * 4;
        // Thin wisps are a shade greyer than dense ones, so the fog keeps some form even over white photos.
        const shade = 176 + density * 62;
        pixels.data[offset] = shade;
        pixels.data[offset + 1] = shade + 6;
        pixels.data[offset + 2] = shade + 12;
        pixels.data[offset + 3] = wisp * vertical * 255;
      }
    }
    ink.putImageData(pixels,0,0);
  });
}

function rollingFog() {
  const layers = [
    { sheet:fogSheet(0,(y) => .3 + .7 * y),                 top:0,   height:1,   scale:1.7, speed:.006, alpha:.26, phase:.1 },
    { sheet:fogSheet(1,(y) => Math.sin(Math.PI * y) ** 1.6), top:.2,  height:.6,  scale:1.3, speed:-.011, alpha:.34, phase:.6 },
    { sheet:fogSheet(2,(y) => between(.05,.9,y)),          top:.5,  height:.5,  scale:1.15, speed:.018, alpha:.5, phase:.35 },
  ];
  return (ink,width,height,time) => {
    ink.globalAlpha = 1;
    const veil = ink.createLinearGradient(0,0,0,height);
    veil.addColorStop(0,'rgb(226 231 236 / 5%)');
    veil.addColorStop(1,'rgb(226 231 236 / 18%)');
    ink.fillStyle = veil;
    ink.fillRect(0,0,width,height);
    for (const layer of layers) {
      // A repeating pattern tiles the sheet without the hairline seams that side-by-side images leave.
      layer.pattern ??= ink.createPattern(layer.sheet,'repeat-x');
      const tile = layer.scale * width;
      const band = layer.height * height;
      const offset = wrap(layer.phase + time * layer.speed) * tile;
      const y = (layer.top + .02 * Math.sin(time * .17 + layer.phase * 9)) * height;
      layer.pattern.setTransform(new DOMMatrix().translate(-offset,y).scale(tile / layer.sheet.width,band / layer.sheet.height));
      ink.globalAlpha = layer.alpha * (.85 + .15 * Math.sin(time * .23 + layer.phase * TAU));
      ink.fillStyle = layer.pattern;
      ink.fillRect(0,y,width,band);
    }
  };
}

const effects = { snow:snowfall, rain:rainfall, fog:rollingFog };

class PortraitWeather extends HTMLElement {
  connectedCallback() {
    const canvas = document.createElement('canvas');
    this.replaceChildren(canvas);
    const ink = canvas.getContext('2d');
    if (!ink) return;
    const paint = effects[this.dataset.weather]();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let frame = 0;

    const draw = (time) => {
      ink.clearRect(0,0,width,height);
      ink.globalAlpha = 1;
      paint(ink,width,height,time);
    };
    const animate = (time) => {
      draw(time / 1000);
      frame = window.requestAnimationFrame(animate);
    };
    const resize = () => {
      window.cancelAnimationFrame(frame);
      width = this.clientWidth;
      height = this.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1,1.8,1600 / Math.max(width,height));
      canvas.width = Math.ceil(width * ratio);
      canvas.height = Math.ceil(height * ratio);
      ink.setTransform(canvas.width / width,0,0,canvas.height / height,0,0);
      if (motion.matches) draw(4);
      else frame = window.requestAnimationFrame(animate);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(this);
    motion.addEventListener('change',resize);
    this.stop = () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change',resize);
    };
  }

  disconnectedCallback() {
    this.stop?.();
  }
}

export function portraitWeatherLayer(weather) {
  if (!Object.hasOwn(effects,weather)) return null;
  if (!customElements.get(tag)) customElements.define(tag,PortraitWeather);
  const layer = document.createElement(tag);
  layer.className = 'portrait-weather';
  layer.dataset.weather = weather;
  layer.setAttribute('aria-hidden','true');
  return layer;
}
