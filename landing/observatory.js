// A finite, decorative point sculpture. It never represents account data.
// The same geometry produces the static SVG fallback and the live canvas.
const TAU = Math.PI * 2;
const points = [];
for (let ring = 0; ring < 192; ring += 1) {
  const u = (ring / 192) * TAU;
  for (let tube = 0; tube < 42; tube += 1) {
    const v = (tube / 42) * TAU;
    const radius = 218 + 76 * Math.cos(v);
    points.push({
      x: radius * Math.cos(u),
      y: radius * Math.sin(u),
      z: 76 * Math.sin(v),
      nx: Math.cos(v) * Math.cos(u),
      ny: Math.cos(v) * Math.sin(u),
      nz: Math.sin(v),
    });
  }
}

function rotate(x, y, z, tilt, turn) {
  const a = 0.96 + tilt;
  const b = -0.3 + turn;
  const c = -0.48;
  const y1 = y * Math.cos(a) - z * Math.sin(a);
  const z1 = y * Math.sin(a) + z * Math.cos(a);
  const x2 = x * Math.cos(b) + z1 * Math.sin(b);
  const z2 = -x * Math.sin(b) + z1 * Math.cos(b);
  return {
    x: x2 * Math.cos(c) - y1 * Math.sin(c),
    y: x2 * Math.sin(c) + y1 * Math.cos(c),
    z: z2,
  };
}

const orbit = [];
for (let step = 0; step <= 240; step += 1) {
  const angle = (step / 240) * TAU;
  const x = Math.cos(angle) * 356;
  const y = Math.sin(angle) * 182;
  orbit.push({
    x: 400 + x * Math.cos(-0.48) - y * Math.sin(-0.48),
    y: 400 + x * Math.sin(-0.48) + y * Math.cos(-0.48),
  });
}

export function sculptureGeometry(tilt = 0, turn = 0, spin = 0) {
  // Spin around the torus's own axis before projecting it into the fixed view.
  // Only three basis vectors need trigonometry, not every individual dot.
  const xAxis = rotate(Math.cos(spin), Math.sin(spin), 0, tilt, turn);
  const yAxis = rotate(-Math.sin(spin), Math.cos(spin), 0, tilt, turn);
  const zAxis = rotate(0, 0, 1, tilt, turn);
  const project = (x, y, z) => ({
    x: x * xAxis.x + y * yAxis.x + z * zAxis.x,
    y: x * xAxis.y + y * yAxis.y + z * zAxis.y,
    z: x * xAxis.z + y * yAxis.z + z * zAxis.z,
  });
  const dots = points.map((point) => {
    const position = project(point.x, point.y, point.z);
    const normal = project(point.nx, point.ny, point.nz);
    const perspective = 1000 / (1000 - position.z);
    const light = Math.max(
      0,
      normal.x * -0.42 + normal.y * -0.55 + normal.z * 0.72,
    );
    const depth = (position.z + 280) / 560;
    return {
      x: 400 + position.x * perspective,
      y: 400 + position.y * perspective,
      radius: (0.65 + light * 0.7) * perspective,
      tone: Math.max(
        0,
        Math.min(11, Math.round((0.13 + light * 0.64 + depth * 0.2) * 11)),
      ),
      z: position.z,
    };
  });
  // All dots have the same ink color, so alpha compositing needs no depth sort.
  return { dots, orbit };
}

export function initObservatory() {
  const root = document.querySelector(".observatory");
  if (!root) return;
  const canvas = root.querySelector("canvas");
  let context = canvas?.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  let pointer = { x: 0, y: 0 };
  let frame = null;
  let visible = false;
  let contextAvailable = Boolean(context);
  let size = 0;
  let pixelRatio = 1;
  let spin = 0;
  let lastFrameTime = null;
  let lastPaintTime = null;
  let view = { tilt: 0, turn: 0 };
  const style = getComputedStyle(root);
  const color = style.getPropertyValue("--ink").trim();
  const background = style.getPropertyValue("--bg").trim();
  const revolutionMs =
    parseFloat(style.getPropertyValue("--sculpture-duration")) * 1000;
  const allowMotion = () => !reduce.matches && fine.matches;
  const canPaint = () =>
    visible && !document.hidden && contextAvailable && size > 0;
  const isRunning = () => canPaint() && !reduce.matches;

  // Keep one animation clock; suspension preserves the last rendered phase.
  const syncMotion = () => {
    const running = isRunning();
    root.dataset.motion = running ? "running" : "paused";
    if (!running) {
      lastFrameTime = null;
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    }
  };

  const paint = (time) => {
    frame = null;
    if (!canPaint()) return;
    const running = isRunning();
    // Limit the decorative canvas to 30 fps, including high-refresh displays.
    if (running && lastPaintTime !== null && time - lastPaintTime < 1000 / 30) {
      schedule();
      return;
    }
    if (running && lastFrameTime !== null) {
      spin =
        (spin + (Math.min(time - lastFrameTime, 100) / revolutionMs) * TAU) %
        TAU;
    }
    lastFrameTime = running ? time : null;
    lastPaintTime = time;
    if (allowMotion()) {
      const scroll = Math.max(
        -1,
        Math.min(0, root.getBoundingClientRect().top / innerHeight),
      );
      view = {
        tilt: pointer.y * 0.13 + scroll * 0.08,
        turn: pointer.x * 0.16,
      };
    } else if (reduce.matches || !fine.matches) {
      view = { tilt: 0, turn: 0 };
    }
    const scene = sculptureGeometry(view.tilt, view.turn, spin);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.globalAlpha = 1;
    context.fillStyle = background;
    context.fillRect(0, 0, size, size);
    context.scale(size / 800, size / 800);
    context.strokeStyle = color;
    context.globalAlpha = 0.25;
    context.lineWidth = 0.7;
    context.beginPath();
    scene.orbit.forEach(({ x, y }, index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.fillStyle = color;
    const batches = Array.from({ length: 12 }, () => []);
    for (const point of scene.dots) batches[point.tone].push(point);
    for (let tone = 0; tone < batches.length; tone += 1) {
      context.globalAlpha = (tone + 1) / 12;
      context.beginPath();
      for (const point of batches[tone]) {
        context.moveTo(point.x + point.radius, point.y);
        context.arc(point.x, point.y, point.radius, 0, TAU);
      }
      context.fill();
    }
    context.globalAlpha = 1;
    root.dataset.ready = "true";
    if (running) schedule();
  };

  const schedule = () => {
    if (frame === null && canPaint()) frame = requestAnimationFrame(paint);
  };
  new ResizeObserver(([entry]) => {
    size = entry.contentRect.width;
    pixelRatio = Math.min(devicePixelRatio || 1, 2);
    if (canvas) {
      canvas.width = Math.round(size * pixelRatio);
      canvas.height = Math.round(size * pixelRatio);
    }
    syncMotion();
    schedule();
  }).observe(root);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncMotion();
    schedule();
  }).observe(root);
  root.addEventListener("pointermove", (event) => {
    if (!allowMotion()) return;
    const bounds = root.getBoundingClientRect();
    pointer = {
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 2,
      y: ((event.clientY - bounds.top) / bounds.height - 0.5) * 2,
    };
    schedule();
  });
  root.addEventListener("pointerleave", () => {
    if (!allowMotion()) return;
    pointer = { x: 0, y: 0 };
    schedule();
  });
  document.addEventListener("visibilitychange", () => {
    syncMotion();
    schedule();
  });
  addEventListener(
    "scroll",
    () => {
      if (allowMotion()) schedule();
    },
    { passive: true },
  );
  const reset = () => {
    pointer = { x: 0, y: 0 };
    syncMotion();
    schedule();
  };
  reduce.addEventListener("change", reset);
  fine.addEventListener("change", reset);
  canvas?.addEventListener("contextlost", () => {
    contextAvailable = false;
    root.dataset.ready = "false";
    syncMotion();
  });
  canvas?.addEventListener("contextrestored", () => {
    context = canvas.getContext("2d");
    contextAvailable = Boolean(context);
    syncMotion();
    schedule();
  });
  syncMotion();
}
