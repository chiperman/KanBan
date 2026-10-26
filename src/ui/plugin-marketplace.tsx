"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { comparePluginVersions } from '@/domain/plugin-version';
import type { AvailablePluginStatus, GitHubPluginCatalog, PluginCatalogStatus, PluginManagementAction, PluginManagementStatus } from '@/domain/plugin-management';
import { VibeButton, VibeLink } from '@/ui/vibe/vibe-button';
import { VibeNotice } from '@/ui/vibe/vibe-notice';
import { VibeDialog } from '@/ui/vibe/vibe-dialog';
import { VibeStatusTag } from '@/ui/vibe/vibe-data-instrument';
import { VibeField, VibeSelect } from '@/ui/vibe/vibe-field';
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from '@/ui/owner-request-lock';
type ImportInfo = { id: string; label: string; version: string; publisher: string; summary: string; sha256: string };
type Confirmation = { action: PluginManagementAction; id: string; label: string; version?: string; repository?: string; sha256?: string } | { action: 'import'; file: File; info: ImportInfo };
async function result<T>(response: Response): Promise<T> {
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  const body = await readJsonResult<T & { error?: string }>(response);
  if (!response.ok || !body || body.error) throw new Error(body?.error ?? '插件操作失败，请重试');
  return body;
}
export function PluginMarketplace({ initialStatus, initialCatalog = null, demoMode = false }: {
  initialStatus: PluginManagementStatus;
  initialCatalog?: PluginCatalogStatus | null;
  demoMode?: boolean;
}) {
  const [status, setStatus] = useState(initialStatus), [catalog, setCatalog] = useState<PluginCatalogStatus | null>(initialCatalog);
  const [catalogError, setCatalogError] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false), [pending, setPending] = useState(false);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null), busy = useRef(false), router = useRouter();
  const checkCatalog = useCallback(async (refresh = false) => {
    if (demoMode) return;
    setChecking(true); setCatalogError('');
    try { setCatalog(await result<PluginCatalogStatus>(await fetch(`/api/plugins?catalog=1${refresh ? '&refresh=1' : ''}`, { cache: 'no-store' }))); }
    catch (e) { setCatalogError(e instanceof Error ? e.message : '无法读取插件目录'); }
    finally { setChecking(false); }
  }, [demoMode]);
  useEffect(() => { void checkCatalog(); }, [checkCatalog]);
  async function inspect(file: File) {
    if (demoMode || busy.current) return;
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('插件包不能超过 16 MiB');
      const body = new FormData(); body.set('file', file); body.set('action', 'inspect');
      const info = await result<ImportInfo>(await fetch('/api/plugins/import', { method: 'POST', body }));
      setConfirmation({ action: 'import', file, info });
    } catch (e) { setError(e instanceof Error ? e.message : '无法读取插件包'); }
    finally { busy.current = false; setPending(false); if (upload.current) upload.current.value = ''; }
  }
  async function change(operation: Exclude<Confirmation, { action: 'import' }>) {
    return result<PluginManagementStatus>(await fetch('/api/plugins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation) }));
  }
  async function perform(operation: Confirmation) {
    if (demoMode || busy.current) return;
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      let updated: PluginManagementStatus;
      if (operation.action === 'import') {
        const body = new FormData(); body.set('file', operation.file); body.set('action', 'install'); body.set('trusted', 'true'); body.set('sha256', operation.info.sha256);
        updated = await result<PluginManagementStatus>(await fetch('/api/plugins/import', { method: 'POST', body }));
      } else updated = await change(operation);
      setStatus(updated); setConfirmation(null); setMessage('插件已更新。'); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '插件操作失败'); setConfirmation(null); }
    finally { busy.current = false; setPending(false); }
  }
  const entries = new Map<string, AvailablePluginStatus>();
  for (const p of catalog?.plugins ?? []) entries.set(p.id, p);
  for (const p of status.installed) if (!entries.has(p.id)) entries.set(p.id, p);
  const visible = [...entries.values()].filter(p => (filter !== 'installed' || status.installed.some(i => i.id === p.id)) && `${p.label} ${p.id} ${p.summary} ${p.publisher}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="plugin-marketplace" aria-labelledby="plugin-marketplace-title">
    <header className="plugin-marketplace__heading">
      <div><h2 id="plugin-marketplace-title">集成插件</h2><p>按需添加账户接入、行情与链上服务。</p></div>
      <div className="plugin-marketplace__actions">
        <VibeButton disabled={demoMode || checking || pending} onClick={() => void checkCatalog(true)}>{checking ? '正在检查…' : '检查更新'}</VibeButton>
        <VibeButton disabled={demoMode || pending} onClick={() => setGithubOpen(true)}>从 GitHub 安装</VibeButton>
        <VibeButton disabled={demoMode || pending} onClick={() => upload.current?.click()}>导入插件包</VibeButton>
        <input ref={upload} type="file" accept=".tar.gz,application/gzip" hidden disabled={demoMode} aria-label="选择插件包" onChange={e => { const file = e.currentTarget.files?.[0]; if (file) void inspect(file); }} />
      </div>
    </header>
    <div className="plugin-marketplace__filters">
      <div role="group" aria-label="插件范围" className="plugin-marketplace__actions">
        <VibeButton aria-pressed={filter === 'all'} variant={filter === 'all' ? 'outline' : 'text'} onClick={() => setFilter('all')}>全部插件</VibeButton>
        <VibeButton aria-pressed={filter === 'installed'} variant={filter === 'installed' ? 'outline' : 'text'} onClick={() => setFilter('installed')}>已安装（{status.installed.length}）</VibeButton>
      </div>
      <label className="vibe-field"><span className="vibe-field__label">搜索插件</span><input className="vibe-field__input" type="search" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="名称、用途或开发者" /></label>
    </div>
    {catalogError ? <VibeNotice tone="info" role="status">{catalogError} 已安装插件仍可管理，也可从 GitHub 安装或导入插件包。</VibeNotice> : null}
    {catalog?.notice ? <VibeNotice tone="info" role="status">{catalog.notice}</VibeNotice> : null}
    {error ? <VibeNotice tone="error" role="alert">{error}</VibeNotice> : null}
    {message ? <VibeNotice tone="success" role="status">{message}</VibeNotice> : null}
    <div className="plugin-marketplace__grid" aria-busy={pending || checking}>
      {visible.map(p => {
        const installed = status.installed.find(i => i.id === p.id), published = catalog?.plugins.find(i => i.id === p.id);
        const update = installed && published?.version && comparePluginVersions(published.version, installed.version) > 0;
        return <article className="plugin-marketplace__card" key={p.id} aria-labelledby={`plugin-${p.id}`}>
          <header><h3 id={`plugin-${p.id}`}>{p.label}</h3><VibeStatusTag tone={installed && !installed.healthy ? 'error' : 'muted'}>{installed ? !installed.healthy ? '文件损坏' : installed.enabled ? '已启用' : '已停用' : '未安装'}</VibeStatusTag></header>
          <p>{p.summary}</p>
          <div className="plugin-marketplace__meta"><span>{p.publisher}</span>{installed?.version || p.version ? <span>v{installed?.version ?? p.version}</span> : null}</div>
          <div className="plugin-marketplace__actions">
            {!installed ? <VibeButton disabled={demoMode || pending || !p.version} onClick={() => setConfirmation({ action: 'install', id: p.id, label: p.label, version: p.version ?? undefined, repository: p.repository, sha256: p.sha256 })}>{p.version ? '安装' : '待发布'}</VibeButton> : <>
              {update ? <VibeButton disabled={demoMode || pending} onClick={() => setConfirmation({ action: 'update', id: p.id, label: p.label, version: published.version ?? undefined, repository: published.repository, sha256: published.sha256 })}>更新至 {published.version}</VibeButton> : null}
              <VibeButton disabled={demoMode || pending} onClick={() => void perform({ action: installed.enabled ? 'disable' : 'enable', id: p.id, label: p.label })}>{installed.enabled ? '停用' : '启用'}</VibeButton>
              <VibeButton disabled={demoMode || pending} variant="text" onClick={() => setConfirmation({ action: 'uninstall', id: p.id, label: p.label })}>卸载</VibeButton>
              {installed.healthy && installed.enabled && installed.assetSource ? demoMode ? <VibeButton disabled variant="text">添加账户</VibeButton> : <VibeLink href="/asset-sources/new" variant="text">添加账户</VibeLink> : null}
            </>}
            {p.homepage ? <VibeLink href={p.homepage} target="_blank" rel="noreferrer" variant="text">项目主页</VibeLink> : null}
          </div>
          {installed?.retainedVersions.length ? <details><summary>历史版本</summary><div className="plugin-marketplace__versions">{installed.retainedVersions.map(v => <VibeButton key={v} disabled={demoMode || pending} size="compact" variant="text" onClick={() => setConfirmation({ action: 'rollback', id: p.id, label: p.label, version: v })}>回滚至 {v}</VibeButton>)}</div></details> : null}
        </article>;
      })}
    </div>
    {!visible.length ? <p role="status">{checking ? '正在获取插件目录…' : query ? '没有匹配的插件。' : filter === 'installed' ? '尚未安装插件。' : '插件目录暂不可用。'}</p> : null}
    <footer className="plugin-marketplace__heading"><span>目录：{status.repository}{catalog?.release ? ` · ${catalog.release}` : ''}</span><div className="plugin-marketplace__actions"><VibeLink href={`https://github.com/${status.repository}/blob/main/docs/operations/plugin-development.md`} target="_blank" rel="noreferrer" variant="text">开发与上架插件</VibeLink><VibeLink href={`https://github.com/${status.repository}/issues`} target="_blank" rel="noreferrer" variant="text">问题反馈</VibeLink></div></footer>
    {githubOpen ? <GitHubPluginInstallDialog onClose={() => setGithubOpen(false)} onInstalled={updated => {
      setStatus(updated); setGithubOpen(false); setError(''); setMessage('插件已安装。'); router.refresh(); void checkCatalog();
    }} /> : null}
    {confirmation ? <VibeDialog titleId="plugin-confirm-title" title={confirmation.action === 'import' ? `安装 ${confirmation.info.label}` : `${({ install: '安装', update: '更新', uninstall: '卸载', rollback: '回滚', enable: '启用', disable: '停用' })[confirmation.action]} ${confirmation.label}`} onClose={() => { if (!pending) setConfirmation(null); }}
      description={confirmation.action === 'uninstall' ? '移除插件后会停止此接入的读取，账户、凭证与历史仍然保留。' : confirmation.action === 'rollback' ? `将使用已保留的 ${confirmation.version} 版本。账户与历史保留。` : '插件会在运行 KanBan 的电脑上执行代码。请确认信任其开发者和发布来源后安装。'}
      actions={<><VibeButton disabled={pending} variant="text" onClick={() => setConfirmation(null)}>取消</VibeButton><VibeButton disabled={pending} onClick={() => void perform(confirmation)}>{pending ? '正在处理…' : '确认'}</VibeButton></>}>
      {confirmation.action === 'import' ? <div><p>{confirmation.info.publisher} · v{confirmation.info.version} · {confirmation.info.id}</p><p>{confirmation.info.summary}</p><p className="plugin-marketplace__checksum">SHA-256：{confirmation.info.sha256}</p></div> : null}
      {confirmation.action !== 'import' && ['install', 'update'].includes(confirmation.action) ? <div><p>v{confirmation.version}</p>{confirmation.repository ? <VibeLink href={`https://github.com/${confirmation.repository}`} target="_blank" rel="noreferrer" variant="text">{confirmation.repository}</VibeLink> : null}</div> : null}
    </VibeDialog> : null}
  </section>;
}

function GitHubPluginInstallDialog({ onClose, onInstalled }: {
  onClose: () => void;
  onInstalled: (status: PluginManagementStatus) => void;
}) {
  const [source, setSource] = useState(''), [catalog, setCatalog] = useState<GitHubPluginCatalog | null>(null);
  const [selectedId, setSelectedId] = useState(''), [error, setError] = useState('');
  const [pending, setPending] = useState<'inspect' | 'install' | null>(null), busy = useRef(false);
  const selected = catalog?.plugins.find(p => p.id === selectedId);
  async function inspect() {
    if (busy.current || !source.trim()) return;
    busy.current = true; setPending('inspect'); setError('');
    try {
      const next = await result<GitHubPluginCatalog>(await fetch('/api/plugins/github', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inspect', source }),
      }));
      setCatalog(next); setSelectedId(next.plugins[0]?.id ?? '');
    } catch (e) { setError(e instanceof Error ? e.message : '无法查看插件，请检查仓库地址后重试'); }
    finally { busy.current = false; setPending(null); }
  }
  async function install() {
    if (busy.current || !catalog || !selected) return;
    busy.current = true; setPending('install'); setError('');
    try {
      const updated = await result<PluginManagementStatus>(await fetch('/api/plugins/github', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          action: 'install', source: `https://github.com/${catalog.repository}/releases/tag/${catalog.release}`,
          id: selected.id, version: selected.version, repository: catalog.repository, sha256: selected.sha256,
        }),
      }));
      onInstalled(updated);
    } catch (e) { setError(e instanceof Error ? e.message : '安装未完成，请重试；已有插件保持不变'); }
    finally { busy.current = false; setPending(null); }
  }
  return <VibeDialog titleId="github-plugin-install-title" title="从 GitHub 安装" onClose={() => { if (!busy.current) onClose(); }}
    description="填写开发者提供的公开仓库或 Release 地址，无需先上架插件目录。"
    onSubmit={event => { event.preventDefault(); void (catalog ? install() : inspect()); }}
    actions={<><VibeButton type="button" disabled={!!pending} variant="text" onClick={onClose}>取消</VibeButton>{catalog ? <VibeButton disabled={!!pending || !selected} type="submit">{pending === 'install' ? '正在安装…' : '确认安装'}</VibeButton> : null}</>}>
    <div className="plugin-marketplace__install" aria-busy={!!pending}>
      <VibeField fieldId="github-plugin-source" label="GitHub 仓库或 Release 地址" value={source} maxLength={500} disabled={!!pending} placeholder="owner/repo 或 https://github.com/owner/repo" autoCapitalize="none" spellCheck={false}
        onChange={event => { setSource(event.currentTarget.value); setCatalog(null); setSelectedId(''); setError(''); }} />
      <div className="plugin-marketplace__actions"><VibeButton type="button" disabled={!!pending || !source.trim()} onClick={() => void inspect()}>{pending === 'inspect' ? '正在查看…' : catalog ? '重新查看' : '查看插件'}</VibeButton></div>
      {error ? <VibeNotice tone="error" role="alert">{error}</VibeNotice> : null}
      {catalog ? <>
        {catalog.plugins.length > 1 ? <VibeSelect fieldId="github-plugin-selection" label="选择插件" value={selectedId} disabled={!!pending} onValueChange={id => { setSelectedId(id); setError(''); }} options={catalog.plugins.map(p => ({ value: p.id, label: `${p.label} · v${p.version}` }))} /> : null}
        {selected ? <div className="plugin-marketplace__install">
          <h3>{selected.label} · v{selected.version}</h3><p>{selected.summary}</p><p>{selected.publisher} · {selected.id}</p>
          <VibeLink href={`https://github.com/${catalog.repository}/releases/tag/${catalog.release}`} target="_blank" rel="noreferrer" variant="text">{catalog.repository} · {catalog.release}</VibeLink>
          <p className="plugin-marketplace__checksum">SHA-256：{selected.sha256}</p>
          <p>插件会在运行 KanBan 的电脑上执行代码。请确认信任其开发者和发布来源后安装。</p>
        </div> : null}
        <VibeLink href={`https://github.com/${catalog.repository}/issues`} target="_blank" rel="noreferrer" variant="text">向开发者反馈问题</VibeLink>
      </> : null}
    </div>
  </VibeDialog>;
}
