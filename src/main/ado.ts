import { randomUUID } from 'node:crypto';
import type { AdoAuth, Inbox, PrStatus, PullRequest, Snapshot, Source, ChangedFile } from '../shared/types';
import { makeDiff, parseSource, prIdentity } from './domain';
import type { Store } from './store';

interface AdoPr {
  pullRequestId: number; title: string; description?: string; status: PullRequest['status']; isDraft?: boolean;
  createdBy: { displayName: string }; creationDate: string;
  repository: { id: string; name: string; project: { name: string } };
  sourceRefName: string; targetRefName: string;
  lastMergeSourceCommit?: { commitId: string }; lastMergeTargetCommit?: { commitId: string }; lastMergeCommit?: { commitId: string };
  reviewers?: { displayName: string; vote: number }[];
}
interface Change { item: { path: string; originalPath?: string; isFolder?: boolean }; originalPath?: string; changeType: string; changeTrackingId?: number }
interface List<T> { value: T[] }

export class Ado {
  constructor(private store: Store, private bearerToken: (auth: Exclude<AdoAuth, 'pat'>) => Promise<string>, private progress: (text: string) => void) {}
  source(id: string) {
    const source = this.store.settings.sources.find((item) => item.id === id);
    if (!source) { throw new Error('This source was removed.'); }
    return source;
  }
  private async request(source: Source, path: string, params: Record<string, string> = {}, init?: RequestInit) {
    const url = new URL(`${source.organization}/${encodeURIComponent(source.project)}/_apis/git/${path}`);
    url.searchParams.set('api-version', '7.1');
    for (const [key, value] of Object.entries(params)) { url.searchParams.set(key, value); }
    const token = source.auth === 'pat' ? this.store.secret(source.id) : await this.bearerToken(source.auth);
    if (!token) { throw new Error(`Reconnect ${source.label}: no ADO credential is available.`); }
    const authorization = source.auth === 'pat' ? `Basic ${Buffer.from(`:${token}`).toString('base64')}` : `Bearer ${token}`;
    const response = await fetch(url, { ...init, headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(45_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`ADO ${response.status} for ${source.label}. ${response.status === 401 || response.status === 403 ? 'Check credentials, Code access, and organization policy.' : 'The request could not be completed.'}`);
    }
    return response;
  }
  private async json<T>(source: Source, path: string, params?: Record<string, string>, init?: RequestInit): Promise<T> {
    const response = await this.request(source, path, params, init);
    return response.json() as Promise<T>;
  }
  async addSource(input: { url: string; pat: string; auth: AdoAuth }) {
    const parsed = parseSource(input.url);
    const duplicate = this.store.settings.sources.find((source) => source.organization.toLowerCase() === parsed.organization.toLowerCase() && source.project.toLowerCase() === parsed.project.toLowerCase() && source.repository?.toLowerCase() === parsed.repository?.toLowerCase());
    const source: Source = { ...parsed, id: duplicate?.id ?? randomUUID(), auth: input.auth };
    const oldSecret = this.store.secret(source.id);
    if (input.auth === 'pat') {
      if (!input.pat.trim() && !oldSecret) { throw new Error('Enter an Azure DevOps PAT with Code Read & Write scope.'); }
      if (input.pat.trim()) { this.store.setSecret(source.id, input.pat.trim()); }
    }
    try { await this.repositories(source); }
    catch (error) {
      if (oldSecret) { this.store.setSecret(source.id, oldSecret); }
      else { this.store.deleteSecret(source.id); }
      throw error;
    }
    this.store.settings.sources = [...this.store.settings.sources.filter((item) => item.id !== source.id), source];
    return this.store.saveSettings();
  }
  private async repositories(source: Source) {
    if (source.repository) {
      const repo = await this.json<{ id: string; name: string }>(source, `repositories/${encodeURIComponent(source.repository)}`);
      return [repo];
    }
    const repos: { id: string; name: string }[] = [];
    let continuation: string | null = null;
    do {
      const response = await this.request(source, 'repositories', continuation ? { continuationToken: continuation } : {});
      repos.push(...((await response.json()) as List<{ id: string; name: string }>).value);
      const next = response.headers.get('x-ms-continuationtoken');
      if (next && next === continuation) { throw new Error('ADO repository pagination did not advance.'); }
      continuation = next;
    } while (continuation);
    return repos;
  }
  private map(source: Source, pr: AdoPr): PullRequest {
    const result: PullRequest = {
      key: '', sourceId: source.id, id: pr.pullRequestId, title: pr.title, description: pr.description ?? '', status: pr.status,
      draft: !!pr.isDraft, author: pr.createdBy.displayName, created: pr.creationDate, repoId: pr.repository.id, repoName: pr.repository.name,
      project: pr.repository.project.name, sourceBranch: pr.sourceRefName.replace(/^refs\/heads\//, ''), targetBranch: pr.targetRefName.replace(/^refs\/heads\//, ''),
      sourceCommit: pr.lastMergeSourceCommit?.commitId ?? '', targetCommit: pr.lastMergeTargetCommit?.commitId ?? '', baseCommit: '',
      webUrl: `${source.organization}/${encodeURIComponent(source.project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
      reviewers: (pr.reviewers ?? []).map((person) => ({ name: person.displayName, vote: person.vote })),
    };
    result.key = prIdentity(result);
    return result;
  }
  async inbox(status: PrStatus): Promise<Inbox> {
    const prs: PullRequest[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const source of this.store.settings.sources) {
      try {
        const repositories = await this.repositories(source);
        for (const repo of repositories) {
          try {
            for (let skip = 0; ; skip += 100) {
              const page = await this.json<List<AdoPr>>(source, `repositories/${repo.id}/pullrequests`, { 'searchCriteria.status': status, '$top': '100', '$skip': String(skip) });
              for (const raw of page.value) {
                const pr = this.map(source, raw);
                const identity = `${source.organization.toLowerCase()}:${repo.id}:${pr.id}`;
                if (!seen.has(identity)) { prs.push(pr); seen.add(identity); }
              }
              if (page.value.length < 100) { break; }
            }
          } catch (error) { errors.push(`${repo.name}: ${(error as Error).message}`); }
        }
      } catch (error) { errors.push((error as Error).message); }
    }
    return { prs: prs.sort((first, second) => second.created.localeCompare(first.created)), errors };
  }
  private prPath(pr: PullRequest) {
    if (!/^[\da-f-]{36}$/i.test(pr.repoId) || !Number.isSafeInteger(pr.id) || pr.id <= 0) { throw new Error('Invalid PR identifier.'); }
    return `repositories/${pr.repoId}/pullrequests/${pr.id}`;
  }
  async fresh(pr: PullRequest) {
    const source = this.source(pr.sourceId);
    return this.map(source, await this.json<AdoPr>(source, this.prPath(pr)));
  }
  async snapshot(input: PullRequest): Promise<Snapshot> {
    const pr = await this.fresh(input);
    const source = this.source(pr.sourceId);
    const root = this.prPath(pr);
    const iterations = await this.json<List<{ id: number; sourceRefCommit: { commitId: string }; targetRefCommit: { commitId: string }; commonRefCommit: { commitId: string } }>>(source, `${root}/iterations`);
    const latest = iterations.value.at(-1);
    if (!latest) { throw new Error('ADO has not produced a PR iteration yet.'); }
    pr.sourceCommit = latest.sourceRefCommit.commitId;
    pr.baseCommit = latest.commonRefCommit.commitId;
    if (!pr.sourceCommit || !pr.baseCommit || !pr.targetCommit) { throw new Error('Commit information is incomplete. Refresh after ADO finishes processing this PR.'); }
    const changes: Change[] = [];
    for (let skip = 0; ; ) {
      const page = await this.json<{ changeEntries: Change[]; nextSkip?: number }>(source, `${root}/iterations/${latest.id}/changes`, { '$compareTo': '0', '$top': '1000', '$skip': String(skip) });
      changes.push(...page.changeEntries.filter((entry) => !entry.item.isFolder));
      if (!page.nextSkip) { break; }
      if (page.nextSkip <= skip) { throw new Error('ADO change pagination did not advance.'); }
      skip = page.nextSkip;
    }
    const files: ChangedFile[] = [];
    const warnings: string[] = [];
    let count = 0;
    for (const entry of changes) {
      const path = entry.item.path;
      const oldPath = entry.originalPath ?? entry.item.originalPath ?? path;
      const file: ChangedFile = { path, oldPath, change: entry.changeType, changeTrackingId: entry.changeTrackingId, lines: [] };
      if (++count > 80) { file.skipped = 'File limit (80)'; }
      else {
        this.progress(`Fetching ${count}/${Math.min(changes.length, 80)}: ${path}`);
        try {
          const change = entry.changeType.toLowerCase();
          const before = change.includes('add') && !change.includes('rename') ? '' : await this.content(source, pr, oldPath, pr.baseCommit);
          const after = change.includes('delete') ? '' : await this.content(source, pr, path, pr.sourceCommit);
          file.lines = makeDiff(before, after);
        } catch (error) { file.skipped = (error as Error).message; }
      }
      if (file.skipped) { warnings.push(`${path}: ${file.skipped}`); }
      files.push(file);
    }
    const snapshot = { pr, iteration: latest.id, files, warnings };
    return this.store.saveSnapshot(snapshot);
  }
  private async content(source: Source, pr: PullRequest, path: string, commit: string) {
    const response = await this.request(source, `repositories/${pr.repoId}/items`, { path, 'versionDescriptor.versionType': 'commit', 'versionDescriptor.version': commit, '$format': 'text', download: 'true' });
    if (!response.body) { throw new Error('No file content returned'); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) { break; }
        length += next.value.byteLength;
        if (length > 300_000) { throw new Error('File exceeds 300 KB'); }
        chunks.push(next.value);
      }
    } finally { await reader.cancel(); }
    const content = Buffer.concat(chunks).toString('utf8');
    if (content.includes('\0') || content.includes('\uFFFD')) { throw new Error('Binary or unsupported text encoding'); }
    if (content.split('\n').length > 8000) { throw new Error('File exceeds 8,000 lines'); }
    return content;
  }
  async threads(pr: PullRequest) {
    return (await this.json<List<{ id: number; comments: { content?: string }[] }>>(this.source(pr.sourceId), `${this.prPath(pr)}/threads`)).value;
  }
  async post(pr: PullRequest, payload: unknown) {
    return this.json<{ id: number }>(this.source(pr.sourceId), `${this.prPath(pr)}/threads`, {}, { method: 'POST', body: JSON.stringify(payload) });
  }
}