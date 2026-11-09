import { diffLines } from 'diff';
import { z } from 'zod';
import type { ChangedFile, DiffLine, Finding, PullRequest, Review, Snapshot } from '../shared/types';

export function parseSource(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Use an HTTPS Azure DevOps project or repository URL.');
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  let organization: string;
  if (url.hostname === 'dev.azure.com') {
    const org = parts.shift();
    if (!org) { throw new Error('The organization is missing.'); }
    organization = `https://dev.azure.com/${encodeURIComponent(org)}`;
  } else if (/^[a-z0-9-]+\.visualstudio\.com$/i.test(url.hostname)) {
    organization = url.origin;
    if (parts[0]?.toLowerCase() === 'defaultcollection') {
      organization += '/DefaultCollection';
      parts.shift();
    }
  } else {
    throw new Error('Only dev.azure.com and organization.visualstudio.com are supported.');
  }
  const project = parts.shift();
  if (!project || project.startsWith('_')) { throw new Error('Include a project in the URL.'); }
  const gitIndex = parts.indexOf('_git');
  const repository = gitIndex >= 0 ? parts[gitIndex + 1] : undefined;
  if (gitIndex >= 0 && !repository) { throw new Error('The repository is missing.'); }
  for (const segment of [project, repository].filter(Boolean) as string[]) {
    if (/[\\/\x00-\x1f]/.test(segment) || segment === '..' || segment === '.') {
      throw new Error('Invalid project or repository name.');
    }
  }
  return { organization, project, repository, label: repository ? `${project} / ${repository}` : project };
}

export function makeDiff(before: string, after: string): DiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  return diffLines(before, after).flatMap((part) => {
    const texts = part.value.split('\n');
    if (texts.at(-1) === '') { texts.pop(); }
    return texts.map((text): DiffLine => {
      if (part.added) { return { kind: 'add', text, newLine: newLine++ }; }
      if (part.removed) { return { kind: 'remove', text, oldLine: oldLine++ }; }
      return { kind: 'context', text, oldLine: oldLine++, newLine: newLine++ };
    });
  });
}

export const findingSchema = z.object({
  path: z.string().min(1), line: z.number().int().positive(), side: z.enum(['left', 'right']),
  severity: z.enum(['P1', 'P2', 'P3']), title: z.string().min(1).max(200), body: z.string().min(1).max(12000),
});
export const reviewOutputSchema = z.object({ summary: z.string().min(1).max(12000), findings: z.array(findingSchema).max(100) });

export function validateLocation(finding: Pick<Finding, 'path' | 'side' | 'line'>, files: ChangedFile[]) {
  const file = files.find((item) => item.path === finding.path && !item.skipped);
  if (!file?.lines.some((line) => (finding.side === 'right' ? line.newLine : line.oldLine) === finding.line)) {
    throw new Error(`Finding location is not present in the reviewed content: ${finding.path}:${finding.line}.`);
  }
}

export function assertFresh(review: Review, snapshot: Snapshot) {
  if (review.sourceCommit !== snapshot.pr.sourceCommit || review.targetCommit !== snapshot.pr.targetCommit ||
      review.baseCommit !== snapshot.pr.baseCommit || review.iteration !== snapshot.iteration) {
    throw new Error('This PR changed after the review. Run a fresh review before posting.');
  }
  if (snapshot.pr.status !== 'active') { throw new Error('Comments can only be posted to active PRs.'); }
}

export function threadPayload(finding: Finding, file: ChangedFile, review: Review) {
  const position = { line: finding.line, offset: 1 };
  const prefix = finding.side === 'right' ? 'rightFile' : 'leftFile';
  return {
    comments: [{ parentCommentId: 0, commentType: 1, content: findingText(finding) }],
    status: 1,
    threadContext: {
      filePath: file.path,
      [`${prefix}Start`]: position, [`${prefix}End`]: position,
    },
    pullRequestThreadContext: { ...(file.changeTrackingId !== undefined ? { changeTrackingId: file.changeTrackingId } : {}),
      iterationContext: { firstComparingIteration: 0, secondComparingIteration: review.iteration } },
  };
}

export function findingText(finding: Finding) {
  return `**[${finding.severity}] ${finding.title}**\n\n${finding.body}\n\n---\n\n*Posted by GitHub Copilot via Prism on behalf of the signed-in reviewer.*\n\n<!-- prism:${finding.id} -->`;
}

export function prIdentity(pr: Pick<PullRequest, 'sourceId' | 'repoId' | 'id'>) {
  return `${pr.sourceId}:${pr.repoId}:${pr.id}`;
}