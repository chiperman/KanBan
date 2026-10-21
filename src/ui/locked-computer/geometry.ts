import {
  fitProjection,
  iso,
  pathOf,
  roundedPlan,
  sideMatrix,
  slabOf,
  topMatrix,
  type Plan,
  type Point3,
} from "./iso-kit";

const CASE: Plan = { x: -117, y: -76, w: 234, d: 110, r: 6 };
const CHASSIS: Plan = { x: -123, y: -78, w: 246, d: 128, r: 3 };
const KEYBOARD: Plan = { x: -128, y: 80, w: 256, d: 73, r: 4 };
const bounds = (plan: Plan, z0: number, z1: number): Point3[] =>
  [plan.x, plan.x + plan.w].flatMap((x) =>
    [plan.y, plan.y + plan.d].flatMap((y) =>
      [z0, z1].map((z): Point3 => [x, y, z]),
    ),
  );

export const PROJECTION = fitProjection(
  [...bounds(CASE, 42, 196), ...bounds(CHASSIS, 0, 29), ...bounds(KEYBOARD, 0, 17), [164, 60, 2]],
  680,
  600,
  { pad: 26, azimuth: 60, elevation: 24 },
);

// Keep the world shapes beside their paths for geometry verification.
export const PARTS: { plan: Plan; z: number; height: number; paths: ReturnType<typeof slabOf> }[] = [];
const slab = (plan: Plan, z: number, height: number, bevel = 0.6) => {
  const paths = slabOf(plan, z, height, PROJECTION, 5, bevel);
  PARTS.push({ plan, z, height, paths });
  return paths;
};
const rectangle = (x: number, y: number, w: number, d: number, r = 0.6): Plan =>
  ({ x, y, w, d, r });

export const ART = {
  chassisFeet: [-104, 104].flatMap((x) => [-60, 35].map((y) =>
    slab(rectangle(x - 8, y - 5, 16, 10, 1), 0, 4),
  )),
  chassis: slab(CHASSIS, 4, 25, 1),
  monitorFoot: slab(rectangle(-82, -48, 164, 88, 5), 29, 4),
  monitorNeck: slab(rectangle(-45, -29, 90, 50, 4), 33, 9),
  monitor: slab(CASE, 42, 154, 1.4),
  chassisPort: slab(rectangle(123, 26, 2, 12, 1), 10.5, 12, 0.4),
  chassisPlug: slab(rectangle(125, 28, 6, 8, 1), 12.5, 8, 0.5),
  chassisBoot: slab(rectangle(131, 30, 6, 4, 1), 14.5, 4, 0.4),
  keyboardFeet: [-111, 111].flatMap((x) => [89, 143].map((y) =>
    slab(rectangle(x - 4, y - 3, 8, 6, 1), 0, 4),
  )),
  keyboard: slab(KEYBOARD, 4, 7, 0.8),
  keyboardWell: slab(rectangle(-122, 85, 244, 62, 2), 11, 0.3, 0),
  keyboardPlug: slab(rectangle(128, 107, 6, 6, 1), 5, 6, 0.4),
  keyboardBoot: slab(rectangle(134, 108, 4, 4, 1), 6, 4, 0.4),
};

export const FRONT = sideMatrix([0, 34], 0, PROJECTION, "left");
export const GLASS = sideMatrix([0, 27], 0, PROJECTION, "left");
export const SYSTEM_FRONT = sideMatrix([0, 50], 0, PROJECTION, "left");
// The right face runs along -y; its flat section spans local x = -28..70.
export const MONITOR_SIDE = sideMatrix([117, 0], 0, PROJECTION, "right");
export const MONITOR_TOP = topMatrix([0, 0], 196, PROJECTION);
export const KEYBOARD_TOP = topMatrix([0, 0], 11, PROJECTION);
const POWER_POSITION: Point3 = [107, 50, 16.5];
export const POWER_FACE = sideMatrix([POWER_POSITION[0], POWER_POSITION[1]], POWER_POSITION[2], PROJECTION, "left");
export const POWER_POINT = iso(POWER_POSITION, PROJECTION);

// The existing animation keeps its proportions inside the recessed CRT glass.
export const SCREEN_CONTENT = "translate(-114.24 -192.1) scale(0.336)";
export const SCREEN_OUTLINE = pathOf(
  roundedPlan(rectangle(-102.5, -180, 205, 116, 7)),
  true,
);

const bezelRing = roundedPlan(rectangle(-109, -187, 218, 130, 9));
const glassRing = roundedPlan(rectangle(-102.5, -180, 205, 116, 7));
export const SCREEN_RECESS = bezelRing.map(([x, z], i) => pathOf([
  iso([x, 34, -z], PROJECTION),
  iso([bezelRing[(i + 1) % bezelRing.length][0], 34, -bezelRing[(i + 1) % bezelRing.length][1]], PROJECTION),
  iso([glassRing[(i + 1) % glassRing.length][0], 27, -glassRing[(i + 1) % glassRing.length][1]], PROJECTION),
  iso([glassRing[i][0], 27, -glassRing[i][1]], PROJECTION),
], true));

function bezier(a: Point3, b: Point3, c: Point3, d: Point3, count = 36): Point3[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    return a.map((v, axis) => (1 - t) ** 3 * v + 3 * (1 - t) ** 2 * t * b[axis]
      + 3 * (1 - t) * t ** 2 * c[axis] + t ** 3 * d[axis]) as Point3;
  });
}

const coil = Array.from({ length: 481 }, (_, i): Point3 => {
  const angle = Math.PI + i / 480 * 20 * Math.PI;
  return [153 + 7 * Math.cos(angle), 60 + i / 480 * 44, 9 + 7 * Math.sin(angle)];
});
export const CABLE_RADIUS = 0.5;
export const CABLE_POINTS: Point3[] = [
  ...bezier([137, 32, 16.5], [151, 32, 16.5], [146, 59, 18], coil[0]),
  ...coil.slice(1),
  ...bezier(coil[480], [146, 106, -1], [150, 110, 8], [138, 110, 8]).slice(1),
];
export const CABLE_WIDTH = PROJECTION.scale * Math.sqrt(1.6) * CABLE_RADIUS * 2;
// Settled from the full tube geometry; midpoint depth alone misorders coil crossings.
const CABLE_DRAW_ORDER = [
  0, 1, 3, 2, 7, 4, 6, 11, 8, 10, 5, 15, 12, 14, 9, 19, 16, 18, 13,
  23, 20, 22, 17, 27, 24, 26, 21, 31, 28, 30, 25, 35, 32, 34, 29, 39,
  36, 38, 33, 43, 40, 44, 45, 42, 37, 41,
];
export const CABLE = Array.from({ length: Math.ceil((CABLE_POINTS.length - 1) / 12) }, (_, i) => {
  const points = CABLE_POINTS.slice(i * 12, i * 12 + 13);
  return { index: i, d: pathOf(points.map((point) => iso(point, PROJECTION))), points };
}).sort((a, b) => CABLE_DRAW_ORDER.indexOf(a.index) - CABLE_DRAW_ORDER.indexOf(b.index));

const ROWS = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
  [1.5, 1.5, 9, 1.5, 1.5],
];
const LEGENDS = [
  ["ESC", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "HOME", "END"],
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "−", "=", "DEL"],
  ["TAB", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "⌁"],
  ["CAPS", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "′", "ENTER"],
  ["SHIFT", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "SHIFT"],
  ["CTRL", "ALT", "", "ALT", "CTRL"],
];

// Fixed scene order verified against the full slabs, including the wide space bar.
const KEY_DRAW_ORDER = [
  "function-0", "function-1", "function-2", "function-3", "function-4", "function-5", "function-6",
  "function-7", "function-8", "function-9", "function-10", "function-11", "function-12", "function-13", "function-14",
  "0-0", "0-1", "1-0", "0-2", "1-1", "2-0", "0-3", "1-2", "2-1", "3-0",
  "0-4", "4-0", "1-3", "2-2", "0-5", "3-1", "1-4", "4-1", "2-3", "0-6",
  "3-2", "1-5", "2-4", "0-7", "3-3", "1-6", "2-5", "0-8", "3-4", "1-7",
  "2-6", "0-9", "3-5", "1-8", "2-7", "0-10", "3-6", "1-9", "2-8", "0-11",
  "3-7", "1-10", "2-9", "0-12", "3-8", "1-11", "2-10", "0-13", "3-9", "1-12",
  "2-11", "3-10", "4-2", "1-13", "2-12", "3-11", "4-3", "4-4",
];

export const KEYS = ROWS.flatMap((widths, row) => {
  let x = -120;
  return widths.map((units, column) => {
    const width = units * 16;
    const height = 5.15 - row * 0.35;
    const plan = rectangle(x + 0.8, row === 0 ? 86 : 98 + (row - 1) * 9.6, width - 1.6, 8, 1.1);
    x += width;
    return {
      id: row === 0 ? `function-${column}` : `${row - 1}-${column}`,
      paths: slab(plan, 11.3, height, 0.5),
      dish: pathOf(roundedPlan(rectangle(plan.x + 1.1, plan.y + 1.1, plan.w - 2.2, plan.d - 2.2, 0.7))
        .map(([px, py]) => iso([px, py, 11.3 + height], PROJECTION)), true),
      legend: LEGENDS[row][column],
      legendPlane: topMatrix([plan.x + plan.w / 2, plan.y + 5], 11.3 + height, PROJECTION),
    };
  });
}).sort((a, b) => KEY_DRAW_ORDER.indexOf(a.id) - KEY_DRAW_ORDER.indexOf(b.id));
