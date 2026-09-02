/* =========================================
   LIVE PAINT INTRO
========================================= */

const canvas = document.getElementById("paint-canvas");
const ctx = canvas.getContext("2d");

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SEEN_KEY = "paintings-intro-seen";
const ALREADY_SEEN = sessionStorage.getItem(SEEN_KEY);

let vw, vh;
let strokes = [];
let strokeIndex = 0;
let strokeStartTime = null;
let introDone = false;
let rafId = null;

const PAUSE_BETWEEN = 110;

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothArray(arr, radius) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < arr.length) {
        sum += arr[idx];
        count++;
      }
    }
    out.push(sum / count);
  }
  return out;
}

function darken(rgbStr, factor) {
  return rgbStr
    .split(",")
    .map((v) => Math.round(parseInt(v, 10) * factor))
    .join(",");
}

function popEase(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function resizeCanvas() {
  vw = window.innerWidth;
  vh = window.innerHeight;
  canvas.width = vw * DPR;
  canvas.height = vh * DPR;
  canvas.style.width = vw + "px";
  canvas.style.height = vh + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  buildStrokes();
  if (introDone) {
    strokes.forEach((s) => drawStroke(s, 1));
  }
}

function pt(px, py) {
  const dw = vw * 0.32;
  const dh = vh * 0.47;
  const marginX = (vw - dw) / 2;
  const marginY = (vh - dh) / 2;
  return { x: marginX + px * dw, y: marginY + py * dh };
}

function sampleCatmullRom(pts, stepsPerSeg = 32) {
  if (pts.length < 2) return pts;
  const result = [];
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    for (let t = 0; t <= 1; t += 1 / stepsPerSeg) {
      if (i > 1 && t === 0) continue;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      result.push({ x, y });
    }
  }
  return result;
}

function addBrushTexture(stroke, seed) {
  const rand = mulberry32(seed);
  const n = stroke.sampled.length;

  const rawPressure = [];
  for (let i = 0; i < n; i++) rawPressure.push((rand() - 0.5) * 0.42);
  stroke.pressure = smoothArray(rawPressure, 4).map((v) => 1 + v);

  const rawJitterL = [];
  const rawJitterR = [];
  for (let i = 0; i < n; i++) {
    rawJitterL.push((rand() - 0.5) * 0.9);
    rawJitterR.push((rand() - 0.5) * 0.9);
  }
  stroke.jitterL = smoothArray(rawJitterL, 3);
  stroke.jitterR = smoothArray(rawJitterR, 3);

  stroke.hairs = [];
  const hairCount = 10;
  for (let i = 0; i < hairCount; i++) {
    const idx = Math.floor(rand() * (n - 4));
    const side = rand() < 0.5 ? -1 : 1;
    stroke.hairs.push({
      idx,
      span: 1 + Math.floor(rand() * 3),
      perpOffset: side * (0.7 + rand() * 1.2),
      alpha: 0.04 + rand() * 0.08,
    });
  }

  stroke.spineColor = darken(stroke.color, 0.65);
}

function makeSplatter(centers, seed) {
  const rand = mulberry32(seed);
  return centers.map((c) => {
    const baseR = 2.4 + rand() * 2.1;
    const sprayAngle = rand() * Math.PI * 2;

    const vertCount = 9 + Math.floor(rand() * 4);
    const splatVerts = [];
    for (let v = 0; v < vertCount; v++) {
      const a = (v / vertCount) * Math.PI * 2;
      const rNoise = 0.5 + rand() * 0.7;
      splatVerts.push({
        x: Math.cos(a) * baseR * rNoise,
        y: Math.sin(a) * baseR * rNoise,
      });
    }

    const flickCount = 3 + Math.floor(rand() * 3);
    const flicks = [];
    for (let f = 0; f < flickCount; f++) {
      const angleDev = (rand() - 0.5) * 0.95;
      const ang = sprayAngle + angleDev;
      const dist = baseR * (1.6 + rand() * 3.2);
      const flickR = baseR * (0.28 + rand() * 0.38);
      flicks.push({
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist,
        r: flickR,
        angle: ang,
        delay: rand() * 0.2,
      });
    }

    const speckCount = 4 + Math.floor(rand() * 4);
    const specks = [];
    for (let s = 0; s < speckCount; s++) {
      const ang = sprayAngle + (rand() - 0.5) * 1.6;
      const dist = baseR * (3.0 + rand() * 4.8);
      specks.push({
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist,
        r: 0.55 + rand() * 0.7,
        delay: 0.1 + rand() * 0.3,
      });
    }

    return { center: c, baseR, splatVerts, flicks, specks };
  });
}

function buildStrokes() {
  strokes = [
    {
      type: "wash",
      color: "168,190,220",
      alpha: 0.35,
      width: Math.max(vw, vh) * 0.0225,
      duration: 650,
      p: [
        pt(0.23, 1.32),
        pt(0.29, 0.84),
        pt(0.38, 0.66),
        pt(0.43, 0.46),
        pt(0.58, 0.26),
        pt(0.76, -0.25),
      ],
    },
    {
      type: "wash",
      color: "168,190,220",
      alpha: 0.32,
      width: Math.max(vw, vh) * 0.019,
      duration: 550,
      p: [
        pt(0.35, 1.12),
        pt(0.42, 0.82),
        pt(0.52, 0.73),
        pt(0.68, 0.50),
        pt(0.75, 0.45),
        pt(0.82, 0.41),
      ],
    },
    {
      type: "wash",
      color: "255,255,255",
      alpha: 0.50,
      width: Math.max(vw, vh) * 0.014,
      duration: 450,
      p: [pt(0.25, 1.10), pt(0.36, 0.81), pt(0.39, 0.72)],
    },
    {
      type: "wash",
      color: "255,255,255",
      alpha: 0.52,
      width: Math.max(vw, vh) * 0.0125,
      duration: 450,
      p: [pt(0.39, 0.68), pt(0.42, 0.57), pt(0.44, 0.47)],
    },
    {
      type: "wash",
      color: "255,255,255",
      alpha: 0.55,
      width: Math.max(vw, vh) * 0.011,
      duration: 400,
      p: [pt(0.44, 0.43), pt(0.46, 0.31), pt(0.50, 0.21), pt(0.58, 0.11)],
    },
    {
      type: "wash",
      color: "255,255,255",
      alpha: 0.45,
      width: Math.max(vw, vh) * 0.012,
      duration: 400,
      p: [pt(0.48, 0.85), pt(0.62, 0.65), pt(0.65, 0.50), pt(0.72, 0.35)],
    },
    {
      type: "splatter",
      color: "168,190,220",
      duration: 120,
      drops: makeSplatter([pt(0.47, 0.26), pt(0.52, 0.91)], 88),
    },
    {
      type: "line",
      color: "255,255,255",
      alpha: 0.6,
      width: [8.4, 2.1],
      duration: 520,
      p: [
        pt(0.15, 1.20),
        pt(0.22, 0.90),
        pt(0.21, 0.81),
        pt(0.23, 0.72),
        pt(0.26, 0.64),
        pt(0.23, 0.55),
        pt(0.25, 0.47),
        pt(0.30, 0.41),
        pt(0.35, 0.36),
        pt(0.38, 0.31),
        pt(0.36, 0.27),
      ],
    },
  ];

  let seed = 11;
  strokes.forEach((s) => {
    if (s.type === "wash" || s.type === "line") {
      s.sampled = sampleCatmullRom(s.p, 32);
    }
    if (s.type === "line") {
      addBrushTexture(s, seed);
      seed += 37;
    }
  });
}

function buildRibbon(stroke, count, w0, w1) {
  const sampled = stroke.sampled;
  const left = [];
  const right = [];
  const n = sampled.length - 1;
  for (let i = 0; i < count; i++) {
    const p = sampled[i];
    const prev = sampled[Math.max(0, i - 1)];
    const next = sampled[Math.min(sampled.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const t = i / n;
    const baseHalf = ((w0 + (w1 - w0) * t) / 2) * stroke.pressure[i];
    left.push({
      x: p.x + nx * (baseHalf + stroke.jitterL[i]),
      y: p.y + ny * (baseHalf + stroke.jitterL[i]),
    });
    right.push({
      x: p.x - nx * (baseHalf + stroke.jitterR[i]),
      y: p.y - ny * (baseHalf + stroke.jitterR[i]),
    });
  }
  return { left, right };
}

function drawHairs(stroke, count) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.lineCap = "round";
  stroke.hairs.forEach((h) => {
    if (h.idx >= count - 1) return;
    const endIdx = Math.min(count - 1, h.idx + h.span);
    const p0 = stroke.sampled[h.idx];
    const p1 = stroke.sampled[endIdx];
    const prev = stroke.sampled[Math.max(0, h.idx - 1)];
    const next = stroke.sampled[Math.min(stroke.sampled.length - 1, h.idx + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ctx.strokeStyle = `rgba(${stroke.color}, ${h.alpha})`;
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(p0.x + nx * h.perpOffset, p0.y + ny * h.perpOffset);
    ctx.lineTo(p1.x + nx * h.perpOffset, p1.y + ny * h.perpOffset);
    ctx.stroke();
  });
  ctx.restore();
}

function drawSpine(stroke, count) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(${stroke.spineColor}, ${stroke.alpha * 0.4})`;
  ctx.lineWidth = Math.max(0.5, stroke.width[0] * 0.22);
  ctx.beginPath();
  ctx.moveTo(stroke.sampled[0].x, stroke.sampled[0].y);
  for (let i = 1; i < count; i++) ctx.lineTo(stroke.sampled[i].x, stroke.sampled[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawSplatter(stroke, progress) {
  const drops = stroke.drops;
  const n = drops.length;
  const rimColor = darken(stroke.color, 0.65);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  drops.forEach((d, i) => {
    const windowStart = i / n;
    const windowEnd = (i + 1) / n;
    if (progress <= windowStart) return;
    const localT = Math.min(1, (progress - windowStart) / (windowEnd - windowStart));
    const scale = popEase(localT);

    ctx.filter = "blur(85px)";
    ctx.fillStyle = `rgba(${stroke.color}, 0.06)`;
    ctx.beginPath();
    ctx.arc(d.center.x, d.center.y, Math.max(0, d.baseR * 2.2 * scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = "none";

    ctx.save();
    ctx.translate(d.center.x, d.center.y);
    ctx.scale(scale, scale);

    ctx.beginPath();
    d.splatVerts.forEach((v, idx) => {
      if (idx === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();

    ctx.fillStyle = `rgba(${stroke.color}, 0.15)`;
    ctx.fill();

    ctx.strokeStyle = `rgba(${rimColor}, 0.25)`;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    d.flicks.forEach((fl) => {
      const flickLocal = Math.min(1, Math.max(0, (localT - fl.delay) / (1 - fl.delay)));
      if (flickLocal <= 0) return;
      const fScale = popEase(flickLocal);

      ctx.save();
      ctx.translate(fl.dx * fScale, fl.dy * fScale);
      ctx.rotate(fl.angle);

      ctx.beginPath();
      ctx.ellipse(0, 0, fl.r * 1.5 * fScale, fl.r * 0.7 * fScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${stroke.color}, 0.38)`;
      ctx.fill();

      ctx.strokeStyle = `rgba(${rimColor}, 0.48)`;
      ctx.lineWidth = 0.25;
      ctx.stroke();

      ctx.restore();
    });

    d.specks.forEach((sp) => {
      const speckLocal = Math.min(1, Math.max(0, (localT - sp.delay) / (1 - sp.delay)));
      if (speckLocal <= 0) return;
      const sScale = popEase(speckLocal);

      ctx.beginPath();
      ctx.arc(sp.dx * sScale, sp.dy * sScale, sp.r * sScale, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${stroke.color}, ${0.32 * sScale})`;
      ctx.fill();
    });

    ctx.restore();
  });

  ctx.restore();
}

function drawStroke(stroke, progress) {
  if (stroke.type === "wash") {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const count = Math.max(2, Math.floor(stroke.sampled.length * progress));
    const slice = stroke.sampled.slice(0, count);
    if (slice.length > 1) {
      ctx.filter = "blur(9px)";
      ctx.strokeStyle = `rgba(${stroke.color}, ${stroke.alpha})`;
      ctx.lineWidth = stroke.width;
      ctx.beginPath();
      ctx.moveTo(slice[0].x, slice[0].y);
      for (let i = 1; i < slice.length; i++) ctx.lineTo(slice[i].x, slice[i].y);
      ctx.stroke();
      ctx.filter = "none";
    }
    ctx.restore();
  } else if (stroke.type === "line") {
    const count = Math.max(2, Math.floor(stroke.sampled.length * progress));
    if (count > 1) {
      const [w0, w1] = stroke.width;
      const { left, right } = buildRibbon(stroke, count, w0, w1);

      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgba(${stroke.color}, ${stroke.alpha})`;
      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
      ctx.closePath();
      ctx.fill();

      const n = stroke.sampled.length - 1;
      const startHalf = (w0 / 2) * stroke.pressure[0];
      const endT = (count - 1) / n;
      const endHalf = ((w0 + (w1 - w0) * endT) / 2) * stroke.pressure[count - 1];
      ctx.beginPath();
      ctx.arc(stroke.sampled[0].x, stroke.sampled[0].y, startHalf, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(stroke.sampled[count - 1].x, stroke.sampled[count - 1].y, endHalf, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      drawSpine(stroke, count);
      drawHairs(stroke, count);
    }
  } else if (stroke.type === "splatter") {
    drawSplatter(stroke, progress);
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function animate(ts) {
  if (introDone) return;
  if (strokeStartTime === null) strokeStartTime = ts;

  const stroke = strokes[strokeIndex];
  const elapsed = ts - strokeStartTime;
  const rawProgress = Math.max(0, Math.min(1, elapsed / stroke.duration));
  const progress = stroke.type === "splatter" ? rawProgress : easeOutCubic(rawProgress);

  ctx.clearRect(0, 0, vw, vh);
  for (let i = 0; i < strokeIndex; i++) drawStroke(strokes[i], 1);
  drawStroke(stroke, progress);

  if (rawProgress >= 1) {
    strokeIndex++;
    if (strokeIndex >= strokes.length) {
      introDone = true;
      setTimeout(finishIntro, 400);
      return;
    }
    strokeStartTime = ts + PAUSE_BETWEEN;
  }

  rafId = requestAnimationFrame(animate);
}

function finishIntro() {
  if (rafId) cancelAnimationFrame(rafId);
  canvas.classList.add("fade-out");
  setTimeout(() => {
    window.location.href = "gallery.html";
  }, 800);
}

function skipIntro() {
  if (introDone) return;
  introDone = true;
  if (rafId) cancelAnimationFrame(rafId);
  ctx.clearRect(0, 0, vw, vh);
  strokes.forEach((s) => drawStroke(s, 1));
  finishIntro();
}

/* ---------- START ---------- */

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

if (REDUCE_MOTION || ALREADY_SEEN) {
  window.location.href = "gallery.html";
} else {
  sessionStorage.setItem(SEEN_KEY, "1");
  document.addEventListener("click", skipIntro, { once: true });
  document.addEventListener("keydown", skipIntro, { once: true });
  rafId = requestAnimationFrame(animate);
}
// resizeCanvas();
// window.addEventListener("resize", resizeCanvas);

// // Render all strokes fully drawn for editing
// ctx.clearRect(0, 0, vw, vh);
// strokes.forEach((s) => drawStroke(s, 1));