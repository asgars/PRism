import { useDeferredValue, useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronRight, Circle, Command, FileCode2, FolderOpen, GitBranch, GitPullRequest, Inbox, Keyboard, Layers3, LoaderCircle, MessageSquare, MoreHorizontal, Play, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2, Triangle, X } from 'lucide-react';
import type { AdoAuth, AuthStatus, AuthStep, ChangedFile, Finding, PrismApi, PrStatus, PullRequest, Review, Settings, Snapshot } from '../shared/types';
import { samplePrs, sampleReview, sampleSnapshot, sampleSource } from './sample';

declare global { interface Window { prism?: PrismApi } }
const api = window.prism;
const emptySettings: Settings = { sources: [], instructionFolders: [], model: 'auto', expectedLogin: '', entraClientId: '', entraTenantId: 'organizations' };
type Modal = 'settings' | 'source' | 'commands' | 'shortcuts' | null;

function IconButton({ label, children, onClick, disabled, className = '' }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Dialog({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useEffectEvent(close);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const elements = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]') ?? [])];
        const first = elements[0]; const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [title]);
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { close(); } }}><div ref={ref} className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2><IconButton label="Close dialog" onClick={close}><X size={18} /></IconButton></header>{children}
  </div></div>;
}

function SourceForm({ submit, configure }: { submit: (input: { url: string; pat: string; auth: AdoAuth }) => Promise<void>; configure: () => void }) {
  const [url, setUrl] = useState(''); const [pat, setPat] = useState(''); const [auth, setAuth] = useState<AdoAuth>('azure-cli');
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setPending(true); setError('');
    try { await submit({ url, pat, auth }); } catch (cause) { setError(message(cause)); } finally { setPending(false); }
  }
  return <form className="form" onSubmit={save}>
    <label>Project or repository URL<input required type="url" autoFocus placeholder="https://dev.azure.com/organization/project/_git/repo" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
    <label>ADO authentication<select disabled={pending} value={auth} onChange={(event) => setAuth(event.target.value as typeof auth)}><option value="azure-cli">Azure CLI (local account)</option><option value="pat">Personal access token</option><option value="entra">Microsoft account (app registration)</option></select></label>
    {auth === 'entra' && <button className="secondary" type="button" disabled={pending} onClick={configure}><Settings2 size={14} />Microsoft Sign-in Settings</button>}
    {auth === 'pat' && <label>Personal access token<input type="password" required autoComplete="off" placeholder="Code: Read & Write" value={pat} onChange={(event) => setPat(event.target.value)} /></label>}
    {error && <div className="error-inline" role="alert">{error}</div>}
    <div className="form-footer"><ShieldCheck size={16} /><span>{auth === 'azure-cli' ? 'Local Azure CLI account' : 'Credentials secured on this Windows account'}</span><button className="primary" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Connect Source</button></div>
  </form>;
}

function message(error: unknown) { return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error); }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function shortBranch(name: string) { return name.replace(/^refs\/heads\//, ''); }

export function App() {
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [status, setStatus] = useState<PrStatus>('active');
  const [query, setQuery] = useState(''); const deferredQuery = useDeferredValue(query);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selected, setSelected] = useState<PullRequest | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [filePath, setFilePath] = useState(''); const [activeFinding, setActiveFinding] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [loading, setLoading] = useState(false); const [loadingDetail, setLoadingDetail] = useState(false);
  const [reviewing, setReviewing] = useState(false); const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(''); const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState(''); const [demo, setDemo] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null); const [authStep, setAuthStep] = useState<AuthStep | null>(null); const [signingIn, setSigningIn] = useState(false);
  const [signInKind, setSignInKind] = useState<'copilot' | 'entra' | null>(null);
  const [tab, setTab] = useState<'changes' | 'overview'>('changes'); const [showDismissed, setShowDismissed] = useState(false);
  const [editing, setEditing] = useState<Finding | null>(null); const [commandQuery, setCommandQuery] = useState('');
  const selectionVersion = useRef(0); const inboxVersion = useRef(0); const search = useRef<HTMLInputElement>(null); const code = useRef<HTMLDivElement>(null);
  const reviewLocked = reviewing || posting;

  useEffect(() => {
    if (!api) { return; }
    api.settings().then(setSettings).catch((error) => setErrors([message(error)]));
    const stopProgress = api.onProgress(setProgress);
    const stopAuth = api.onAuthStep(setAuthStep);
    return () => { stopProgress(); stopAuth(); };
  }, []);
  useEffect(() => { if (!notice) { return; } const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (demo) { return; } void refresh(); }, [status, settings.sources, demo]);

  async function refresh() {
    if (demo || !api) { return; }
    const version = ++inboxVersion.current;
    setLoading(true);
    try {
      const result = await api.inbox(status);
      if (version === inboxVersion.current) { setPrs(result.prs); setErrors(result.errors); }
    } catch (error) { if (version === inboxVersion.current) { setErrors([message(error)]); } }
    finally { if (version === inboxVersion.current) { setLoading(false); } }
  }
  async function select(pr: PullRequest) {
    if (reviewLocked) { return; }
    const version = ++selectionVersion.current;
    setSelected(pr); setSnapshot(null); setReview(null); setActiveFinding(''); setTab('changes'); setLoadingDetail(true);
    try {
      const [nextSnapshot, nextReview] = demo ? [sampleSnapshot(pr), sampleReview(pr)] : await Promise.all([api!.snapshot(pr), api!.getReview(pr.key)]);
      if (version !== selectionVersion.current) { return; }
      setSnapshot(nextSnapshot); setReview(nextReview); setFilePath(nextSnapshot.files[0]?.path ?? '');
    } catch (error) { if (version === selectionVersion.current) { setErrors([message(error)]); } }
    finally { if (version === selectionVersion.current) { setLoadingDetail(false); } }
  }
  function openSample() {
    inboxVersion.current++; selectionVersion.current++;
    setDemo(true); setLoading(false); setPrs(samplePrs); setSelected(samplePrs[0]); setSnapshot(sampleSnapshot(samplePrs[0])); setReview(sampleReview(samplePrs[0])); setFilePath('/src/queue.ts'); setErrors([]); setSourceFilter('all'); setStatus('active');
  }
  function exitSample() { setDemo(false); setPrs([]); setSelected(null); setSnapshot(null); setReview(null); setSourceFilter('all'); }
  async function runReview() {
    if (!selected || !snapshot || reviewing || posting || demo || !api) { return; }
    if (review?.findings.some((finding) => finding.state === 'draft') && !window.confirm('Replace this review and its local draft findings? Posted comments remain on the PR.')) { return; }
    setReviewing(true); setProgress('Fetching latest PR changes'); setErrors([]);
    try { const result = await api.runReview(selected); setReview(result); const latest = await api.snapshot(selected); setSnapshot(latest); setNotice(`Review complete: ${result.findings.length} findings`); }
    catch (error) { setErrors([message(error)]); }
    finally { setReviewing(false); setProgress(''); }
  }
  function jump(finding: Finding) {
    setFilePath(finding.path); setActiveFinding(finding.id); setTab('changes');
    requestAnimationFrame(() => { code.current?.querySelector(`[data-${finding.side === 'right' ? 'new' : 'old'}="${finding.line}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  }
  async function saveFinding(finding: Finding) {
    if (!selected) { return; }
    if (demo) {
      setReview((current) => current ? { ...current, findings: current.findings.some((item) => item.id === finding.id)
        ? current.findings.map((item) => item.id === finding.id ? finding : item) : [...current.findings, finding] } : current);
    } else { setReview(await api!.saveFinding(selected.key, finding)); }
    setEditing(null); setNotice('Finding saved');
  }
  async function post(finding: Finding) {
    if (!review || demo || posting || reviewing) { return; }
    setPosting(true);
    try { setReview(await api!.postFinding(review.key, finding.id)); }
    catch (error) { setErrors([message(error)]); const latest = await api!.getReview(review.key); setReview(latest); }
    finally { setPosting(false); }
  }
  function addFinding(file: ChangedFile, line: number, side: Finding['side']) {
    if (!selected || reviewLocked) { return; }
    setEditing({ id: crypto.randomUUID(), path: file.path, line, side, severity: 'P2', title: '', body: '', state: 'draft' });
  }
  async function doAction(action: () => Promise<unknown>, success?: string) {
    try { await action(); if (success) { setNotice(success); } } catch (error) { setErrors([message(error)]); }
  }
  async function checkAuth() { if (api) { await doAction(async () => setAuth(await api.copilotStatus())); } }
  async function signIn(kind: 'copilot' | 'entra', method: 'browser' | 'device-code' = 'browser') {
    if (!api) { setErrors(['Open the Prism desktop app to sign in.']); return; }
    setSigningIn(true); setSignInKind(kind); setAuthStep(null);
    try { if (kind === 'copilot') { setAuth(await api.copilotLogin()); } else { await api.entraLogin(method); } setNotice('Sign-in complete'); }
    catch (error) { setErrors([message(error)]); }
    finally { setSigningIn(false); }
  }

  const sources = demo ? [sampleSource] : settings.sources;
  const visible = prs.filter((pr) => (sourceFilter === 'all' || pr.sourceId === sourceFilter) && (status === 'all' || pr.status === status) && `${pr.title} ${pr.id} ${pr.repoName} ${pr.author}`.toLowerCase().includes(deferredQuery.toLowerCase()));
  const file = snapshot?.files.find((item) => item.path === filePath);
  const findings = review?.findings.filter((finding) => showDismissed || finding.state !== 'dismissed') ?? [];
  const draftCount = review?.findings.filter((finding) => finding.state === 'draft').length ?? 0;
  const stale = !!(review && snapshot && (review.sourceCommit !== snapshot.pr.sourceCommit || review.baseCommit !== snapshot.pr.baseCommit || review.targetCommit !== snapshot.pr.targetCommit || review.iteration !== snapshot.iteration));
  const commands = [
    { label: 'Refresh pull requests', shortcut: 'Ctrl R', icon: RefreshCw, action: () => void refresh() },
    { label: 'Run Copilot review', shortcut: 'Ctrl Shift R', icon: Sparkles, action: () => void runReview() },
    { label: 'Add ADO source', shortcut: '', icon: Plus, action: () => setModal('source') },
    { label: 'Settings & connections', shortcut: 'Ctrl ,', icon: Settings2, action: () => { setModal('settings'); void checkAuth(); } },
    { label: 'Keyboard shortcuts', shortcut: '?', icon: Keyboard, action: () => setModal('shortcuts') },
  ];
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const input = event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable);
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandQuery(''); setModal((current) => current === 'commands' ? null : 'commands'); return; }
      if (modal || editing) { return; }
      if (event.ctrlKey && event.key.toLowerCase() === 'r') { event.preventDefault(); if (event.shiftKey) { void runReview(); } else { void refresh(); } return; }
      if (event.ctrlKey && event.key === ',') { event.preventDefault(); setModal('settings'); void checkAuth(); return; }
      if (input) { return; }
      if (event.key === '/') { event.preventDefault(); search.current?.focus(); }
      if (event.key === '?') { setModal('shortcuts'); }
      if (['j', 'k'].includes(event.key) && visible.length && !reviewLocked) {
        event.preventDefault(); const index = visible.findIndex((pr) => pr.key === selected?.key);
        void select(visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === 'j' ? 1 : -1)))]);
      }
      if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) && snapshot?.files.length) {
        event.preventDefault(); const index = snapshot.files.findIndex((item) => item.path === filePath);
        setFilePath(snapshot.files[Math.max(0, Math.min(snapshot.files.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))].path);
      }
    }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  });

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Triangle size={25} strokeWidth={2.2} /></div><span>prism<span className="brand-dot">.</span></span><span className="version">0.1</span></div>
      <button className="workspace-switch" onClick={() => { setModal('settings'); void checkAuth(); }}><span className="workspace-avatar">P</span><span>My Workspace<small>Azure DevOps</small></span><ChevronDown size={14} /></button>
      <div className="nav-label">WORKSPACE</div>
      <button className="nav-item active" onClick={() => setSourceFilter('all')}><Inbox size={18} /><span>Pull requests</span><span className="nav-count">{prs.length}</span></button>
      <button className="nav-item" onClick={() => { setModal('settings'); void checkAuth(); }}><ShieldCheck size={18} /><span>Review instructions</span></button>
      <div className="source-heading"><span className="nav-label">SOURCES</span><IconButton label="Add source" onClick={() => setModal('source')} disabled={reviewLocked}><Plus size={15} /></IconButton></div>
      <button className={`source-item ${sourceFilter === 'all' ? 'selected' : ''}`} onClick={() => setSourceFilter('all')}><Layers3 size={16} /><span>All repositories</span></button>
      {sources.map((source) => <button key={source.id} className={`source-item ${sourceFilter === source.id ? 'selected' : ''}`} title={source.label} onClick={() => setSourceFilter(source.id)}><GitBranch size={16} /><span>{source.label}</span><span className="source-dot" /></button>)}
      {!sources.length && <button className="add-source-link" onClick={() => setModal('source')}><Plus size={14} />Connect a source</button>}
      <div className="sidebar-bottom">
        <div className="copilot-status"><div className="copilot-icon"><Sparkles size={18} /></div><div>GitHub Copilot<small>{auth?.isAuthenticated ? auth.login : 'Not connected'}</small></div><span className={`connection-dot ${auth?.isAuthenticated ? 'online' : ''}`} /></div>
        <button className="nav-item" onClick={() => { setModal('settings'); void checkAuth(); }}><Settings2 size={18} /><span>Settings</span><span className="key-cap">Ctrl ,</span></button>
        <button className="nav-item" onClick={() => setModal('shortcuts')}><Keyboard size={18} /><span>Keyboard shortcuts</span><span className="key-cap">?</span></button>
        <div className="local-label"><ShieldCheck size={12} />LOCAL-FIRST WORKSPACE</div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={14} /><strong>Pull requests</strong></div><div className="topbar-actions">{demo && <button className="sample-badge" onClick={exitSample}>Sample workspace<X size={13} /></button>}<IconButton label="Command palette (Ctrl K)" onClick={() => { setCommandQuery(''); setModal('commands'); }}><Command size={17} /></IconButton><span className="user-avatar">{initials(auth?.login ?? 'My Workspace')}</span></div></header>
      <div className="page-heading"><div><div className="eyebrow">CODE. CONTEXT. CLARITY.</div><h1>Pull requests<span className="heading-count">{prs.length}</span></h1></div><div className="heading-actions"><IconButton label="Refresh pull requests (Ctrl R)" onClick={() => void refresh()} disabled={loading || demo}><RefreshCw size={17} className={loading ? 'spin' : ''} /></IconButton><button className="primary" onClick={() => setModal('source')} disabled={reviewLocked}><Plus size={16} />Add Source</button></div></div>
      {!api && <div className="browser-banner">Browser preview<span>Service connections are available in the Prism desktop app.</span></div>}
      {errors.length > 0 && <div className="error-banner" role="alert"><div>{errors.map((error, index) => <div key={index}>{error}</div>)}</div><IconButton label="Dismiss errors" onClick={() => setErrors([])}><X size={16} /></IconButton></div>}
      <div className="filterbar"><div className="segmented" role="tablist" aria-label="Pull request status">{(['active', 'completed', 'abandoned', 'all'] as PrStatus[]).map((value) => <button key={value} role="tab" aria-selected={value === status} className={value === status ? 'chosen' : ''} onClick={() => setStatus(value)}>{value === 'active' ? 'Open' : value[0].toUpperCase() + value.slice(1)}</button>)}</div><div className="search-box"><Search size={16} /><input ref={search} aria-label="Search pull requests" placeholder="Search pull requests..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>/</kbd></div></div>
      <main className={`workbench ${selected ? 'has-selection' : ''}`}>
        <section className="pr-list" aria-label="Pull request inbox"><div className="list-heading"><span>{visible.length} PULL REQUEST{visible.length === 1 ? '' : 'S'}</span><MoreHorizontal size={17} /></div>
          {loading && !prs.length ? <div className="small-empty"><LoaderCircle className="spin" />Loading pull requests</div> : visible.length ? visible.map((pr) => <button key={pr.key} disabled={reviewLocked} className={`pr-item ${selected?.key === pr.key ? 'current' : ''}`} onClick={() => void select(pr)}>
            <div className="pr-item-meta"><span><GitPullRequest size={14} className={pr.status === 'completed' ? 'merged-icon' : 'green'} />{pr.repoName}</span><span>#{pr.id}</span></div><h3>{pr.title}</h3><div className="pr-item-footer"><span className="mini-avatar">{initials(pr.author)}</span><span>{pr.author}</span>{pr.draft ? <span className="draft-label">Draft</span> : <span className="tiny-status">{pr.status === 'active' ? 'Open' : pr.status}</span>}</div>
          </button>) : <div className="small-empty"><Inbox size={26} /><strong>{sources.length ? 'No matching pull requests' : 'Your inbox starts here'}</strong><span>{sources.length ? 'Nothing in this view.' : 'No sources connected'}</span>{!sources.length && <button className="text-button" onClick={() => setModal('source')}><Plus size={14} />Add a source</button>}</div>}
          <div className="list-bottom"><span className="connection-dot online" />{demo ? 'Sample data' : loading ? 'Syncing' : 'Local workspace'}<span>{sources.length} source{sources.length === 1 ? '' : 's'}</span></div>
        </section>
        <section className="review-space" aria-label="Review workspace">
          {!selected ? <div className="welcome"><div className="welcome-art"><div className="art-line one" /><div className="art-line two" /><div className="art-line three" /><div className="art-prism"><Triangle size={62} strokeWidth={1.2} /></div><div className="art-node"><CheckCheck size={21} /></div></div><div className="eyebrow">A FRESH PERSPECTIVE ON YOUR CODE</div><h2>Your next review,<br />in focus.</h2><p>{sources.length ? 'Select a pull request from your inbox.' : 'Connect an Azure DevOps project or repository.'}</p><div className="welcome-actions"><button className="primary" onClick={() => setModal('source')}><Plus size={16} />Connect Azure DevOps</button><button className="secondary" onClick={openSample}>Open Sample<ArrowUpRight size={16} /></button></div><div className="welcome-bottom"><GitPullRequest size={16} />Azure DevOps<span /> <Sparkles size={16} />GitHub Copilot<span /><ShieldCheck size={16} />Your instructions</div></div> : <>
            <header className="pr-header"><div className="pr-context"><IconButton className="mobile-back" label="Back to inbox" disabled={reviewLocked} onClick={() => setSelected(null)}><ArrowLeft size={16} /></IconButton><span className="status-label"><GitPullRequest size={13} />{selected.status === 'active' ? 'Open' : selected.status}</span><span>{selected.repoName}</span><span>#{selected.id}</span>{selected.draft && <span className="draft-label">Draft</span>}</div><div className="pr-title-row"><h2>{selected.title}</h2><IconButton label="Open PR in Azure DevOps" disabled={demo} onClick={() => void doAction(() => api!.openExternal(selected.webUrl))}><ArrowUpRight size={19} /></IconButton></div><div className="branch-row"><span className="mini-avatar">{initials(selected.author)}</span><span>{selected.author}</span><span className="branch"><GitBranch size={12} />{shortBranch(selected.sourceBranch)}</span><ArrowRight size={13} /><span className="branch">{shortBranch(selected.targetBranch)}</span></div></header>
            <div className="review-toolbar"><div className="view-tabs"><button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}><FileCode2 size={15} />Changes<span>{snapshot?.files.length ?? 0}</span></button><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><GitPullRequest size={15} />Overview</button></div><div className="review-actions">{reviewing ? <button className="secondary" onClick={() => void doAction(() => api!.cancelReview())}><Square size={13} />Cancel</button> : <button className="review-button" onClick={() => void runReview()} disabled={!snapshot || demo || posting || loadingDetail}><Sparkles size={15} />{review ? 'Review Again' : 'Run Review'}</button>}</div></div>
            {reviewing && <div className="progress-banner" role="status"><LoaderCircle size={15} className="spin" />{progress || 'Review in progress'}</div>}
            {stale && <div className="warning-banner">PR changed since this review. Findings are read-only until you run a new review.</div>}
            {loadingDetail ? <div className="detail-loading"><LoaderCircle className="spin" /><span>Fetching PR changes</span><small>{progress}</small></div> : !snapshot ? <div className="detail-loading"><span>Could not load this PR.</span><button className="secondary" onClick={() => void select(selected)}>Retry</button></div> : <div className="detail-body">
              <div className="code-column">{tab === 'overview' ? <div className="overview"><h3>Description</h3><p className="preserve-text">{snapshot.pr.description || 'No description provided.'}</p><h3>Reviewers</h3>{snapshot.pr.reviewers.map((person) => <div className="reviewer-row" key={person.name}><span className="mini-avatar">{initials(person.name)}</span>{person.name}<span>{person.vote >= 10 ? 'Approved' : person.vote === 5 ? 'Approved with suggestions' : person.vote === -10 ? 'Rejected' : person.vote === -5 ? 'Waiting for author' : 'Pending'}</span></div>)}{!snapshot.pr.reviewers.length && <p>No reviewers assigned.</p>}<h3>Review context</h3><dl><dt>Source commit</dt><dd>{snapshot.pr.sourceCommit.slice(0, 12)}</dd><dt>Comparison</dt><dd>Merge base to source, iteration {snapshot.iteration}</dd><dt>Instruction files</dt><dd>{review?.instructions.length ?? 0}</dd></dl>{review?.instructions.map((name) => <div className="instruction-path" key={name}>{name}</div>)}{[...new Set([...snapshot.warnings, ...(review?.warnings ?? [])])].map((warning) => <div className="warning-banner" key={warning}>{warning}</div>)}</div> : <>
                <div className="file-selector"><FileCode2 size={16} /><select aria-label="Changed file" value={filePath} onChange={(event) => { setFilePath(event.target.value); setActiveFinding(''); }}>{snapshot.files.map((item) => <option key={item.path} value={item.path}>{item.path}{item.skipped ? ' (not reviewed)' : ''}</option>)}</select>{file && <div className="diff-counts"><span>+{file.lines.filter((line) => line.kind === 'add').length}</span><span>-{file.lines.filter((line) => line.kind === 'remove').length}</span></div>}</div>
                <div className="file-meta"><span>{file?.change ?? 'No changes'}</span><span>{snapshot.pr.sourceCommit.slice(0, 7)}<Circle size={4} />Unified diff</span></div>
                <div className="diff-view" ref={code}>{file?.skipped ? <div className="warning-banner">{file.skipped}</div> : file?.lines.length ? <div className="diff-table" role="table" aria-label={`Diff for ${file.path}`}>{file.lines.map((line, index) => {
                  const lineFindings = findings.filter((finding) => finding.path === file.path && (finding.side === 'right' ? line.newLine : line.oldLine) === finding.line);
                  const highlighted = lineFindings.some((finding) => finding.id === activeFinding);
                  return <div key={index} className={`diff-row ${line.kind} ${highlighted ? 'highlighted' : ''}`} data-new={line.newLine} data-old={line.oldLine} role="row"><span className="line-old">{line.oldLine}</span><span className="line-new">{line.newLine}</span><span className="line-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}</span><code>{line.text || ' '}</code><button className={`line-comment ${lineFindings.length ? 'has-finding' : ''}`} disabled={reviewLocked || stale} title={lineFindings.length ? `${lineFindings.length} finding(s); add comment` : 'Add finding on this line'} aria-label={`Add finding at ${line.newLine ?? line.oldLine}`} onClick={() => addFinding(file, (line.newLine ?? line.oldLine)!, line.newLine ? 'right' : 'left')}>{lineFindings.length ? <MessageSquare size={12} /> : <Plus size={12} />}</button></div>;
                })}</div> : <div className="small-empty">No text changes.</div>}</div>
                <div className="code-footer"><GitBranch size={13} /><span>{snapshot.pr.repoName}</span><span>{snapshot.files.findIndex((item) => item.path === filePath) + 1} of {snapshot.files.length} files</span></div>
              </>}</div>
              <aside className="findings-panel"><div className="findings-heading"><div><Sparkles size={16} /><h3>Review findings</h3><span>{review?.findings.filter((finding) => finding.state !== 'dismissed').length ?? 0}</span></div><IconButton label={showDismissed ? 'Hide dismissed findings' : 'Show dismissed findings'} onClick={() => setShowDismissed(!showDismissed)}><MoreHorizontal size={17} /></IconButton></div>
                <div className="findings-scroll">{review ? <><div className="review-summary"><div><span className="connection-dot online" />{demo ? 'Sample review' : 'Review complete'}<span>{review.sourceCommit.slice(0, 7)}</span></div><p>{review.summary}</p>{review.warnings.length > 0 && <button className="warning-link" onClick={() => setTab('overview')}>{review.warnings.length} coverage warning(s)<ArrowUpRight size={12} /></button>}</div>{findings.map((finding) => <article key={finding.id} className={`finding ${activeFinding === finding.id ? 'focused' : ''} ${finding.state === 'dismissed' ? 'dismissed' : ''}`}>
                  <div className="finding-top"><span className={`severity ${finding.severity.toLowerCase()}`}>{finding.severity}</span><span>{finding.state === 'posted' ? 'Posted to ADO' : finding.state === 'uncertain' ? 'Posting unconfirmed' : finding.state === 'dismissed' ? 'Dismissed' : 'Draft finding'}</span>{finding.state === 'posted' && <Check size={14} className="green" />}</div><button className="finding-title" onClick={() => jump(finding)}>{finding.title}</button><button className="finding-location" title={finding.path} onClick={() => jump(finding)}><FileCode2 size={12} /><span>{finding.path.split('/').at(-1)}</span><strong>L{finding.line}</strong>{finding.side === 'left' && <span>old</span>}<ArrowUpRight size={12} /></button><p>{finding.body}</p>
                  <div className="finding-actions">{finding.state === 'draft' && <><button className="text-button" disabled={reviewLocked || stale} onClick={() => setEditing({ ...finding })}>Edit</button><IconButton label="Dismiss finding" disabled={reviewLocked || stale} onClick={() => void doAction(() => saveFinding({ ...finding, state: 'dismissed' }))}><X size={14} /></IconButton><button className="post-button" disabled={demo || reviewLocked || stale || selected.status !== 'active'} onClick={() => void post(finding)}><Send size={12} />Post to PR</button></>}{finding.state === 'dismissed' && <button className="text-button" disabled={reviewLocked || stale} onClick={() => void doAction(() => saveFinding({ ...finding, state: 'draft' }))}>Restore</button>}{finding.state === 'uncertain' && <button className="text-button" disabled={reviewLocked} onClick={() => void post(finding)}>Check for posted comment</button>}</div>
                </article>)}{!findings.length && <div className="small-empty"><CheckCheck size={28} /><strong>No findings</strong><span>{showDismissed ? 'No issues were reported.' : 'No active findings in this review.'}</span></div>}</> : <div className="small-empty findings-empty"><Sparkles size={29} /><strong>A second set of eyes</strong><span>No review yet</span><button className="review-button" disabled={demo || reviewLocked} onClick={() => void runReview()}><Play size={14} />Run Review</button></div>}</div>
                <div className="findings-footer"><ShieldCheck size={13} /><span>{draftCount} local draft{draftCount === 1 ? '' : 's'}</span><span>{demo ? 'Sample' : 'Nothing posts automatically'}</span></div>
              </aside>
            </div>}
          </>}
        </section>
      </main>
      <footer className="statusbar"><span><span className="connection-dot online" />{reviewing ? progress : 'All changes stay local until posted'}</span><button onClick={() => { setModal('commands'); setCommandQuery(''); }}><Command size={11} />Command palette<kbd>Ctrl K</kbd></button></footer>
    </div>
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    {modal === 'source' && <Dialog title="Connect Azure DevOps" close={() => { if (!signingIn) { setModal(null); } }}><SourceForm configure={() => setModal('settings')} submit={async (input) => {
      if (!api) { throw new Error('Use the Prism desktop app to connect a real ADO source.'); }
      if (input.auth === 'entra') {
        setSigningIn(true); setSignInKind('entra'); setAuthStep(null);
        try { await api.entraLogin(); } finally { setSigningIn(false); }
      }
      setSettings(await api.addSource(input)); if (demo) { exitSample(); } setModal(null); setNotice('Source connected');
    }} /></Dialog>}
    {modal === 'settings' && <Dialog title="Workspace settings" close={() => { if (!signingIn) { setModal(null); } }} wide><div className="settings-content">
      <section><h3><Sparkles size={16} />GitHub Copilot</h3><div className="account-row"><span className="avatar-large">{auth?.login ? initials(auth.login) : <Sparkles size={21} />}</span><div><strong>{auth?.isAuthenticated ? auth.login : 'Not connected'}</strong><small>{auth?.statusMessage || 'GitHub Enterprise Managed User account'}</small></div><button className="secondary" disabled={signingIn} onClick={() => void signIn('copilot')}>{signingIn ? <LoaderCircle size={15} className="spin" /> : <ArrowUpRight size={15} />}Sign In</button><IconButton label="Check Copilot connection" disabled={signingIn} onClick={() => void checkAuth()}><RefreshCw size={15} /></IconButton></div>
        <div className="settings-grid"><label>Expected EMU login<input placeholder="your-alias_microsoft" value={settings.expectedLogin} onChange={(event) => setSettings({ ...settings, expectedLogin: event.target.value })} /></label><label>Copilot model<input value={settings.model} placeholder="auto" onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></label></div>
      </section>
      <section><div className="settings-section-heading"><h3><FolderOpen size={16} />Review instructions</h3><button className="secondary" disabled={reviewLocked} onClick={() => void doAction(async () => { if (!api) { throw new Error('Folder selection requires the desktop app.'); } setSettings(await api.pickInstructions()); })}><Plus size={14} />Add Folder</button></div>{settings.instructionFolders.length ? settings.instructionFolders.map((folder) => <div className="settings-list-row" key={folder}><FolderOpen size={15} /><span title={folder}>{folder}</span><IconButton label={`Remove ${folder}`} disabled={reviewLocked} onClick={() => void doAction(async () => setSettings(await api!.removeInstructions(folder)))}><X size={15} /></IconButton></div>) : <div className="settings-empty">No instruction folders</div>}</section>
      <section><div className="settings-section-heading"><h3><GitBranch size={16} />Azure DevOps sources</h3><button className="secondary" disabled={reviewLocked} onClick={() => setModal('source')}><Plus size={14} />Add Source</button></div>{settings.sources.map((source) => <div className="settings-list-row" key={source.id}><GitBranch size={15} /><span>{source.label}<small>{source.organization}</small></span><span className="draft-label">{source.auth.toUpperCase()}</span><IconButton label={`Remove ${source.label}`} disabled={reviewLocked} onClick={() => { if (window.confirm(`Remove ${source.label} and its saved credential?`)) { void doAction(async () => { setSettings(await api!.removeSource(source.id)); setSourceFilter('all'); setSelected(null); setSnapshot(null); setReview(null); }); } }}><Trash2 size={15} /></IconButton></div>)}{!settings.sources.length && <div className="settings-empty">No sources connected</div>}
        <details><summary>Advanced Microsoft sign-in (app registration)</summary><div className="settings-grid"><label>Approved public-client app ID<input value={settings.entraClientId} onChange={(event) => setSettings({ ...settings, entraClientId: event.target.value })} /></label><label>Tenant ID or domain<input value={settings.entraTenantId} onChange={(event) => setSettings({ ...settings, entraTenantId: event.target.value })} /></label></div><div className="account-row"><button className="secondary" disabled={signingIn || !api} onClick={() => void doAction(async () => { await api!.saveSettings(settings); await signIn('entra'); })}><ArrowUpRight size={14} />Sign In with Microsoft</button><button className="text-button" disabled={signingIn || !api} onClick={() => void doAction(async () => { await api!.saveSettings(settings); await signIn('entra', 'device-code'); })}><Keyboard size={14} />Use Device Code</button></div></details>
      </section>
      {authStep && <div className="auth-step" role="status">{authStep.code && <strong className="device-code">{authStep.code}</strong>}{authStep.url && <button className="text-button" onClick={() => void doAction(() => api!.openExternal(authStep.url!))}>Open Sign-in Page<ArrowUpRight size={14} /></button>}<span>{authStep.message ?? (authStep.kind === 'completed' ? 'Sign-in complete' : 'Waiting for browser authorization')}</span>{signingIn && signInKind === 'copilot' && <button className="text-button" onClick={() => void doAction(() => api!.cancelLogin())}>Cancel Copilot Sign-in</button>}</div>}
    </div><div className="dialog-footer"><span><ShieldCheck size={14} />Windows-encrypted credentials</span><button className="primary" disabled={!api || signingIn} onClick={() => void doAction(async () => { setSettings(await api!.saveSettings(settings)); setModal(null); }, 'Settings saved')}><Check size={15} />Save Settings</button></div></Dialog>}
    {modal === 'commands' && <Dialog title="Command palette" close={() => setModal(null)}><div className="command-search"><Search size={17} /><input autoFocus aria-label="Search commands" placeholder="Find a command..." value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} /></div><div className="command-list">{commands.filter((command) => command.label.toLowerCase().includes(commandQuery.toLowerCase())).map((command) => <button key={command.label} onClick={() => { setModal(null); command.action(); }}><command.icon size={17} /><span>{command.label}</span><kbd>{command.shortcut}</kbd></button>)}</div></Dialog>}
    {modal === 'shortcuts' && <Dialog title="Keyboard shortcuts" close={() => setModal(null)}><div className="shortcut-list">{[['Command palette', 'Ctrl K'], ['Search pull requests', '/'], ['Next / previous pull request', 'J / K'], ['Next / previous file', 'Alt Right / Left'], ['Refresh inbox', 'Ctrl R'], ['Run Copilot review', 'Ctrl Shift R'], ['Workspace settings', 'Ctrl ,'], ['Close dialog', 'Escape']].map(([label, shortcut]) => <div key={label}><span>{label}</span><kbd>{shortcut}</kbd></div>)}</div></Dialog>}
    {editing && <FindingEditor finding={editing} files={snapshot?.files ?? []} save={saveFinding} close={() => setEditing(null)} />}
  </div>;
}

function FindingEditor({ finding, files, save, close }: { finding: Finding; files: ChangedFile[]; save: (finding: Finding) => Promise<void>; close: () => void }) {
  const [value, setValue] = useState(finding); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  return <Dialog title={finding.title ? 'Edit finding' : 'Add finding'} close={close}><form className="form" onSubmit={async (event) => { event.preventDefault(); setPending(true); setError(''); try { await save(value); } catch (cause) { setError(message(cause)); } finally { setPending(false); } }}>
    <label>Title<input required maxLength={200} value={value.title} onChange={(event) => setValue({ ...value, title: event.target.value })} /></label><label>Finding<textarea required rows={7} maxLength={12000} value={value.body} onChange={(event) => setValue({ ...value, body: event.target.value })} /></label><label>File<select value={value.path} onChange={(event) => setValue({ ...value, path: event.target.value })}>{files.filter((file) => !file.skipped).map((file) => <option value={file.path} key={file.path}>{file.path}</option>)}</select></label><div className="settings-grid three"><label>Line<input type="number" required min={1} value={value.line} onChange={(event) => setValue({ ...value, line: Number(event.target.value) })} /></label><label>Side<select value={value.side} onChange={(event) => setValue({ ...value, side: event.target.value as Finding['side'] })}><option value="right">New version</option><option value="left">Old version</option></select></label><label>Severity<select value={value.severity} onChange={(event) => setValue({ ...value, severity: event.target.value as Finding['severity'] })}><option>P1</option><option>P2</option><option>P3</option></select></label></div>{error && <div className="error-inline">{error}</div>}<div className="form-footer"><span>Saved locally, not posted</span><button className="primary" disabled={pending}><Check size={15} />Save Finding</button></div>
  </form></Dialog>;
}