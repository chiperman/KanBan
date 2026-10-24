// Run in an isolated, built checkout. Temporary test state and virtual Passkeys only.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const temporary = await mkdtemp(path.join(tmpdir(), 'kanban-https-auth-'));
let app, browser, proxy;
try {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const appPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const key = path.join(temporary, 'key.pem');
  const cert = path.join(temporary, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  proxy = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: appPort, path: request.url, method: request.method, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, resolve));
  const origin = 'https://localhost:' + proxy.address().port;
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(appPort)], {
    env: { ...process.env, APP_ENV: 'test', KANBAN_DATA_DIR: temporary, PAD_PUBLIC_ORIGIN: origin, PAD_SECRET_ENCRYPTION_KEY: randomBytes(32).toString('base64') }, stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw new Error('隔离应用启动失败');
    try { ready = (await fetch('http://127.0.0.1:' + appPort)).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, '隔离应用未就绪');
  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  await page.request.post('/test-doubles/reset');
  await page.goto('/setup');
  const optionsResponse = page.waitForResponse('**/api/auth/register/options');
  await page.getByRole('button', { name: '创建所有者 Passkey' }).click();
  const challengeHeader = await (await optionsResponse).headerValue('set-cookie');
  assert.match(challengeHeader, /Secure/);
  assert.match(challengeHeader, /HttpOnly/);
  assert.match(challengeHeader, /SameSite=Strict/);
  await expect(page.getByRole('status')).toContainText('预置完成');
  assert.ok(!(await context.cookies()).some(cookie => cookie.name === 'pad_webauthn_challenge_' + appPort));
  await page.getByRole('link', { name: '返回所有者登录' }).click();
  await page.getByRole('button', { name: '使用 Passkey 登录' }).click();
  await expect(page.getByTestId('workbench-shell')).toBeVisible();
  const session = (await context.cookies()).find(cookie => cookie.name === 'pad_session_' + appPort);
  assert.ok(session?.secure && session.httpOnly && session.sameSite === 'Lax');
  assert.equal(session.expires, -1);
  const failed = await page.request.post('/api/auth/login/verify', { data: {} });
  assert.equal(failed.status(), 400);
  assert.match(failed.headers()['set-cookie'], /Secure/);
  const logout = await page.request.post('/api/auth/logout');
  assert.ok(logout.ok());
  assert.match(logout.headers()['set-cookie'], /Secure/);
  assert.ok(!(await context.cookies()).some(cookie => cookie.name === 'pad_session_' + appPort));
  await page.reload();
  await expect(page.getByRole('heading', { name: '看板已锁定' })).toBeVisible();
  console.info('HTTPS 注册、登录、失败清理、退出与会话删除通过（临时证书和虚拟认证器）');
} finally {
  await browser?.close();
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  if (app && app.exitCode === null) { app.kill(); await new Promise(resolve => app.once('exit', resolve)); }
  await rm(temporary, { recursive: true, force: true });
}
