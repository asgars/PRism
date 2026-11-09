import type { Finding, PullRequest, Review, Snapshot, Source } from '../shared/types';
import { makeDiff } from '../main/domain';

export const sampleSource: Source = { id: 'sample', organization: 'https://dev.azure.com/prism-example', project: 'Engineering', label: 'Engineering', auth: 'pat' };
export const samplePr: PullRequest = {
  key: 'sample:repo:2841', sourceId: 'sample', id: 2841, title: 'Make the review queue resilient to interrupted requests',
  description: 'Preserve pending reviews across reconnects and introduce a retry policy for transient service failures.', status: 'active', draft: false,
  author: 'Alex Morgan', created: new Date().toISOString(), repoId: 'sample-repo', repoName: 'review-service', project: 'Engineering',
  sourceBranch: 'feature/resilient-queue', targetBranch: 'main', sourceCommit: '9a32f14', targetCommit: '6ef71a0', baseCommit: '6ef71a0',
  webUrl: '', reviewers: [{ name: 'Jordan Lee', vote: 10 }, { name: 'Sam Rivera', vote: 0 }],
};
export const samplePrs: PullRequest[] = [samplePr,
  { ...samplePr, id: 2837, key: 'sample:repo:2837', title: 'Add repository-level review preferences', author: 'Jordan Lee', sourceBranch: 'feature/review-preferences', repoName: 'developer-portal' },
  { ...samplePr, id: 2829, key: 'sample:repo:2829', title: 'Reduce duplicate requests in the activity feed', author: 'Sam Rivera', sourceBranch: 'fix/activity-feed', draft: true },
];
const before = `import { store } from './store';\nimport { api } from './api';\n\nexport async function processQueue() {\n  const pending = await store.getPending();\n\n  for (const review of pending) {\n    const result = await api.submit(review);\n    await store.markCompleted(review.id, result);\n  }\n}\n`;
const after = `import { store } from './store';\nimport { api } from './api';\nimport { retry } from './retry';\n\nexport async function processQueue() {\n  const pending = await store.getPending();\n\n  for (const review of pending) {\n    try {\n      const result = await retry(\n        () => api.submit(review),\n        { attempts: 3, delay: 1000 },\n      );\n      await store.markCompleted(review.id, result);\n    } catch (error) {\n      await store.remove(review.id);\n      console.error('Submission failed', error);\n    }\n  }\n}\n`;
export function sampleSnapshot(pr: PullRequest): Snapshot {
  return { pr, iteration: 2, warnings: [], files: [
    { path: '/src/queue.ts', oldPath: '/src/queue.ts', change: 'edit', lines: makeDiff(before, after) },
    { path: '/src/retry.ts', oldPath: '/src/retry.ts', change: 'add', lines: makeDiff('', `export async function retry<T>(\n  action: () => Promise<T>,\n  options: { attempts: number; delay: number },\n): Promise<T> {\n  for (let attempt = 0; ; attempt++) {\n    try { return await action(); }\n    catch (error) {\n      if (attempt >= options.attempts) throw error;\n      await new Promise(resolve => setTimeout(resolve, options.delay));\n    }\n  }\n}\n`) },
  ] };
}
export function sampleReview(pr: PullRequest): Review {
  const findings: Finding[] = [{ id: 'sample-finding-1', path: '/src/queue.ts', line: 16, side: 'right', severity: 'P1', title: 'Keep failed submissions in the pending queue', body: 'When all retries fail during an outage, removing the review permanently drops an unsubmitted request. Nothing remains to retry after reconnection. Keep the pending record and record the failure so the next queue pass can retry it.', state: 'draft' },
    { id: 'sample-finding-2', path: '/src/retry.ts', line: 8, side: 'right', severity: 'P2', title: 'Stop after the configured number of attempts', body: 'With attempts set to 3, the loop invokes the action four times because the counter starts at zero and the boundary is checked after execution. Stop when attempt + 1 reaches the configured limit.', state: 'draft' }];
  return { key: pr.key, sourceCommit: pr.sourceCommit, baseCommit: pr.baseCommit, targetCommit: pr.targetCommit, iteration: 2, created: new Date().toISOString(), summary: 'Two failure-handling issues need attention. Failed submissions can be lost permanently, and the retry boundary exceeds the configured attempt count.', instructions: ['example/review-guidelines.md'], warnings: [], findings };
}