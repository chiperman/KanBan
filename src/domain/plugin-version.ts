export function comparePluginVersions(a: string, b: string): number {
  const [coreA, preA] = a.split(/-(.*)/s), [coreB, preB] = b.split(/-(.*)/s);
  const x = coreA.split('.').map(Number), y = coreB.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  if (preA === preB) return 0;
  if (!preA) return 1; if (!preB) return -1;
  const p = preA.split('.'), q = preB.split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1; if (q[i] === undefined) return 1;
    if (p[i] === q[i]) continue;
    const pn = /^\d+$/.test(p[i]), qn = /^\d+$/.test(q[i]);
    if (pn && qn) return Number(p[i]) - Number(q[i]);
    if (pn !== qn) return pn ? -1 : 1;
    return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}
