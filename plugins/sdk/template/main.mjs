import manifest from './manifest.json' with { type: 'json' };
import { createAuthorization, readSnapshot } from './provider.mjs';
// Standalone protocol v1 entry point. stdout is reserved for JSON-RPC; log to stderr.
let buffer = '', initialized = false;
const active = new Map();
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) process.exit(1);
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    let request;
    try { request = JSON.parse(line); if (request.jsonrpc !== '2.0') throw new Error(); } catch { process.exit(1); }
    if (request.method === 'cancel' && request.id === undefined) { active.get(request.params?.id)?.abort(); continue; }
    if (!Number.isSafeInteger(request.id) || active.has(request.id) || active.size >= 32) process.exit(1);
    const controller = new AbortController(); active.set(request.id, controller);
    void (async () => {
      const p = request.params;
      if (request.method === 'initialize' && !initialized && p?.protocolVersion === 1) { initialized = true; return manifest; }
      if (!initialized) throw new Error('尚未握手');
      if (request.method === 'authorization.preview') return createAuthorization(p.input, p.observedAt, controller.signal);
      if (request.method === 'authorization.revalidate') return createAuthorization(JSON.parse(p.authorization.credentials), p.observedAt, controller.signal);
      if (request.method === 'assets.read') return { snapshot: await readSnapshot(JSON.parse(p.credentials), p.attemptedAt, controller.signal) };
      throw new Error('不支持的方法');
    })().then(result => send({ jsonrpc: '2.0', id: request.id, result }), () => send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: '只读接入失败' } })).finally(() => active.delete(request.id));
  }
});
process.stdin.on('end', () => process.exit(0));
