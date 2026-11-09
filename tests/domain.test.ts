import { describe, expect, it } from 'vitest';
import { assertFresh, makeDiff, parseSource, threadPayload, validateLocation } from '../src/main/domain';
import type { ChangedFile, Finding, Review, Snapshot } from '../src/shared/types';

describe('Azure DevOps sources', () => {
  it('preserves DefaultCollection and decoded repository names', () => {
    expect(parseSource('https://microsoft.visualstudio.com/DefaultCollection/OS/_git/My%20Repo')).toEqual({
      organization: 'https://microsoft.visualstudio.com/DefaultCollection', project: 'OS', repository: 'My Repo', label: 'OS / My Repo',
    });
  });
  it('accepts a whole project', () => {
    expect(parseSource('https://dev.azure.com/team/Project')).toMatchObject({ organization: 'https://dev.azure.com/team', project: 'Project', repository: undefined });
  });
  it.each(['https://evil.example/OS', 'http://dev.azure.com/team/OS', 'https://user:pass@dev.azure.com/team/OS', 'https://dev.azure.com/org', 'https://dev.azure.com/org/%2fother'])('rejects unsafe or incomplete URL %s', (url) => {
    expect(() => parseSource(url)).toThrow();
  });
});

describe('diff locations', () => {
  const lines = makeDiff('first\nold\nlast\n', 'first\nnew\nlast\n');
  const file: ChangedFile = { path: '/new.ts', oldPath: '/old.ts', change: 'rename, edit', changeTrackingId: 7, lines };
  const finding: Finding = { id: 'one', path: '/new.ts', line: 2, side: 'left', severity: 'P2', title: 'Bug', body: 'Evidence', state: 'draft' };
  it('keeps correct old and new line numbers', () => {
    expect(lines).toEqual([
      { kind: 'context', text: 'first', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'old', oldLine: 2 },
      { kind: 'add', text: 'new', newLine: 2 },
      { kind: 'context', text: 'last', oldLine: 3, newLine: 3 },
    ]);
  });
  it('rejects hallucinated locations and skipped files', () => {
    expect(() => validateLocation({ ...finding, line: 200 }, [file])).toThrow();
    expect(() => validateLocation(finding, [{ ...file, skipped: 'binary' }])).toThrow();
    expect(() => validateLocation(finding, [file])).not.toThrow();
  });
  it('anchors deleted lines to the left side with rename tracking metadata', () => {
    const payload = threadPayload(finding, file, { iteration: 3 } as Review);
    expect(payload.threadContext).toMatchObject({ filePath: '/new.ts', leftFileStart: { line: 2, offset: 1 } });
    expect(payload.pullRequestThreadContext.changeTrackingId).toBe(7);
    expect(payload.pullRequestThreadContext.iterationContext.secondComparingIteration).toBe(3);
    expect(payload.comments[0].content).toContain('<!-- prism:one -->');
  });
  it('rejects changed source, target, base, iteration and closed PRs', () => {
    const review = { sourceCommit: 'a', targetCommit: 'b', baseCommit: 'c', iteration: 1 } as Review;
    const snapshot = { pr: { ...review, status: 'active' }, iteration: 1 } as unknown as Snapshot;
    expect(() => assertFresh(review, snapshot)).not.toThrow();
    for (const field of ['sourceCommit', 'targetCommit', 'baseCommit', 'status']) {
      expect(() => assertFresh(review, { ...snapshot, pr: { ...snapshot.pr, [field]: 'changed' } })).toThrow();
    }
    expect(() => assertFresh(review, { ...snapshot, iteration: 2 })).toThrow();
  });
});