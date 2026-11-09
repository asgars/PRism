import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ado } from '../src/main/ado';
import type { Store } from '../src/main/store';
import type { Source } from '../src/shared/types';

const source: Source = { id: 'source', organization: 'https://microsoft.visualstudio.com/DefaultCollection', project: 'OS', repository: 'repo', label: 'OS/repo', auth: 'pat' };
const rawPr = { pullRequestId: 1, title: 'Review', status: 'active', createdBy: { displayName: 'Reviewer' }, creationDate: '2026-11-09', repository: { id: '00000000-0000-4000-8000-000000000001', name: 'repo', project: { name: 'OS' } }, sourceRefName: 'refs/heads/topic', targetRefName: 'refs/heads/main', lastMergeSourceCommit: { commitId: 'source-commit' }, lastMergeTargetCommit: { commitId: 'target-commit' } };
function makeStore(sources = [source]) { return { settings: { sources }, secret: () => 'secret', saveSnapshot: (snapshot: unknown) => snapshot } as unknown as Store; }
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
beforeEach(() => { vi.restoreAllMocks(); });
describe('ADO transport', () => {
  it('uses the selected CLI token provider as a bearer token without a PAT', async () => {
    const bearerToken = vi.fn().mockResolvedValue('isolated-cli-token');
    const secret = vi.fn(() => undefined);
    const store = makeStore([{ ...source, auth: 'azure-cli' }]); store.secret = secret;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer isolated-cli-token');
      return String(input).includes('/pullrequests') ? response({ value: [rawPr] }) : response(rawPr.repository);
    });
    const result = await new Ado(store, bearerToken, () => undefined).inbox('active');
    expect(result.errors).toEqual([]); expect(result.prs).toHaveLength(1);
    expect(bearerToken).toHaveBeenCalledWith('azure-cli');
    expect(secret).not.toHaveBeenCalled();
  });
  it('paginates PRs and never forwards credentials through redirects', async () => {
    let pages = 0;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain('/DefaultCollection/OS/_apis/git/');
      expect(init?.redirect).toBe('error'); expect((init?.headers as Record<string, string>).Authorization).toContain('Basic ');
      if (url.pathname.endsWith('/pullrequests')) { pages++; return response({ value: url.searchParams.get('$skip') === '0' ? Array.from({ length: 100 }, (_, index) => ({ ...rawPr, pullRequestId: index + 1 })) : [] }); }
      return response({ id: rawPr.repository.id, name: 'repo' });
    });
    const result = await new Ado(makeStore(), async () => '', () => undefined).inbox('active');
    expect(result.prs).toHaveLength(100); expect(pages).toBe(2); expect(result.errors).toEqual([]); expect(fetch).toHaveBeenCalled();
  });
  it('surfaces per-source errors and keeps successful sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/repositories/broken')) { return response({}, 403); }
      return String(input).includes('/pullrequests') ? response({ value: [rawPr] }) : response({ id: rawPr.repository.id, name: 'repo' });
    });
    const result = await new Ado(makeStore([source, { ...source, id: 'broken', repository: 'broken' }]), async () => '', () => undefined).inbox('all');
    expect(result.prs).toHaveLength(1); expect(result.errors[0]).toContain('403');
  });
  it('loads whole-project repositories and deduplicates overlapping sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/pullrequests')) { return response({ value: [rawPr] }); }
      if (url.pathname.endsWith('/repositories')) { return response({ value: [rawPr.repository] }); }
      return response(rawPr.repository);
    });
    const result = await new Ado(makeStore([source, { ...source, id: 'project', repository: undefined }]), async () => '', () => undefined).inbox('all');
    expect(result.prs).toHaveLength(1);
  });
  it('fetches exact merge-base and source commits and reports unsupported files', async () => {
    const commits: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/iterations')) { return response({ value: [{ id: 2, sourceRefCommit: { commitId: 'source-commit' }, targetRefCommit: { commitId: 'target-commit' }, commonRefCommit: { commitId: 'base-commit' } }] }); }
      if (url.pathname.endsWith('/changes')) { return response({ changeEntries: [{ item: { path: '/code.ts' }, changeType: 'edit' }, { item: { path: '/image.png' }, changeType: 'add' }] }); }
      if (url.pathname.endsWith('/items')) { commits.push(url.searchParams.get('versionDescriptor.version')!); return new Response(url.searchParams.get('path')?.endsWith('.png') ? '\0binary' : url.searchParams.get('versionDescriptor.version') === 'base-commit' ? 'old\n' : 'new\n'); }
      return response(rawPr);
    });
    const ado = new Ado(makeStore(), async () => '', () => undefined);
    const inboxPr = { sourceId: source.id, repoId: rawPr.repository.id, id: 1 } as any;
    const snapshot = await ado.snapshot(inboxPr);
    expect(commits).toEqual(['base-commit', 'source-commit', 'source-commit']);
    expect(snapshot.files[0].lines[1]).toMatchObject({ kind: 'add', newLine: 1, text: 'new' });
    expect(snapshot.warnings[0]).toContain('Binary');
  });
});