import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'prism-smoke-'));
const screenshots = join(tmpdir(), 'prism-verification');
const { mkdir } = await import('node:fs/promises');
await mkdir(screenshots, { recursive: true });
let application;
try {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    ...(process.env.PRISM_EXECUTABLE ? { executablePath: process.env.PRISM_EXECUTABLE } : {}),
    args: [...(process.env.PRISM_EXECUTABLE ? [] : [resolve('out/main/index.js')]), `--user-data-dir=${directory}`], env: environment,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Your next review, in focus.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Source', exact: true })).toBeVisible();
  await page.screenshot({ path: join(screenshots, 'desktop-empty.png') });
  await page.getByRole('button', { name: 'Open Sample' }).click();
  await expect(page.getByRole('heading', { name: 'Review findings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post to PR' }).first()).toBeDisabled();
  await page.getByRole('button', { name: 'Keep failed submissions in the pending queue' }).click();
  await expect(page.locator('.diff-row.highlighted')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByLabel('Title', { exact: true }).fill('Preserve requests during outages');
  await page.getByRole('button', { name: 'Save Finding' }).click();
  await expect(page.getByRole('button', { name: 'Preserve requests during outages' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss finding' }).first().click();
  await expect(page.getByRole('button', { name: 'Preserve requests during outages' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show dismissed findings' }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preserve requests during outages' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  const commandSearch = page.getByRole('textbox', { name: 'Search commands' });
  await commandSearch.click();
  await page.keyboard.type('settings');
  await expect(commandSearch).toHaveValue('settings');
  await expect(commandSearch).toBeFocused();
  await page.getByRole('button', { name: /Settings & connections/ }).click();
  await expect(page.getByRole('dialog', { name: 'Workspace settings' })).toBeVisible();
  for (const [label, value] of [['Expected EMU login', 'reviewer_microsoft'], ['Copilot model', 'auto']]) {
    const field = page.getByRole('textbox', { name: label, exact: true });
    await field.fill('');
    await field.click();
    await page.keyboard.type(value);
    await expect(field).toHaveValue(value);
    await expect(field).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Workspace settings' })).toHaveCount(0);
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Search pull requests' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Search pull requests' }).fill('duplicate');
  await expect(page.locator('.pr-item')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search pull requests' }).fill('');
  await page.getByRole('textbox', { name: 'Search pull requests' }).blur();
  await page.screenshot({ path: join(screenshots, 'desktop-review.png') });
  for (const width of [1100, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Review findings' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `No page-level overflow at ${width}px`).toBe(false);
    if (width <= 640) {
      const findingsFit = await page.locator('.findings-scroll').evaluate((panel) => {
        const bounds = panel.getBoundingClientRect();
        return [...panel.querySelectorAll('.finding, .review-summary')].every((item) => {
          const itemBounds = item.getBoundingClientRect();
          return itemBounds.left >= bounds.left && itemBounds.right <= bounds.right && item.scrollWidth <= item.clientWidth;
        });
      });
      expect(findingsFit, 'Narrow findings fit within the panel without horizontal scrolling').toBe(true);
    }
    await page.screenshot({ path: join(screenshots, `review-${width}.png`) });
  }
  const runtime = await page.evaluate(async () => {
    try { return await window.prism.copilotStatus(); }
    catch (error) { return { runtimeError: error.message }; }
  });
  console.log('COPILOT_RUNTIME', JSON.stringify(runtime));
  expect(runtime.runtimeError, 'Bundled Copilot runtime starts without installation').toBeUndefined();
  const invalidMethodRejected = await page.evaluate(async () => {
    try { await window.prism.entraLogin('unsupported'); return false; }
    catch { return true; }
  });
  expect(invalidMethodRejected, 'The privileged auth handler validates the requested method').toBe(true);
  await application.evaluate(({ ipcMain }) => {
    globalThis.prismAuthMethods = [];
    ipcMain.removeHandler('entraLogin');
    ipcMain.handle('entraLogin', (event, method = 'browser') => {
      globalThis.prismAuthMethods.push(method);
      event.sender.send('authStep', method === 'device-code'
        ? { kind: 'device-code', code: 'TEST-CODE', url: 'https://microsoft.com/devicelogin', message: 'Isolated device-code fixture' }
        : { kind: 'completed', message: 'Isolated browser sign-in fixture' });
    });
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.keyboard.press('Control+Comma');
  await expect(page.getByRole('dialog', { name: 'Workspace settings' })).toBeVisible();
  await page.getByText('Advanced Microsoft sign-in (app registration)', { exact: true }).click();
  await page.getByRole('button', { name: 'Sign In with Microsoft', exact: true }).click();
  await expect(page.getByText('Isolated browser sign-in fixture', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use Device Code', exact: true }).click();
  await expect(page.getByText('TEST-CODE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel Copilot Sign-in' })).toHaveCount(0);
  expect(await application.evaluate(() => globalThis.prismAuthMethods)).toEqual(['browser', 'device-code']);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: /Sample workspace/ }).click();
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    const rawPr = { pullRequestId: 42, title: 'Mocked integration PR', description: 'Isolated transport fixture', status: 'active', createdBy: { displayName: 'Test Reviewer' }, creationDate: '2026-11-09', repository: { id: '00000000-0000-4000-8000-000000000001', name: 'integration', project: { name: 'Tests' } }, sourceRefName: 'refs/heads/topic', targetRefName: 'refs/heads/main', lastMergeSourceCommit: { commitId: 'source' }, lastMergeTargetCommit: { commitId: 'target' } };
    const threads = [];
    globalThis.prismPostCount = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== 'dev.azure.com') { throw new Error('Tests cannot access remote services.'); }
      let data;
      if (url.pathname.endsWith('/threads') && init?.method === 'POST') {
        const payload = JSON.parse(init.body);
        if (payload.threadContext.rightFileStart.line !== 1 || payload.threadContext.filePath !== '/src/example.ts') { throw new Error('Incorrect comment anchor'); }
        globalThis.prismPostCount++;
        const thread = { ...payload, id: 99 }; threads.push(thread); data = thread;
      } else if (url.pathname.endsWith('/threads')) { data = { value: threads }; }
      else if (url.pathname.endsWith('/iterations')) { data = { value: [{ id: 1, sourceRefCommit: { commitId: 'source' }, targetRefCommit: { commitId: 'target' }, commonRefCommit: { commitId: 'base' } }] }; }
      else if (url.pathname.endsWith('/changes')) { data = { changeEntries: [{ item: { path: '/src/example.ts' }, changeType: 'edit', changeTrackingId: 1 }] }; }
      else if (url.pathname.endsWith('/items')) { return new Response(url.searchParams.get('versionDescriptor.version') === 'base' ? 'const value = 1;\n' : 'const value = 2;\n'); }
      else if (url.pathname.endsWith('/pullrequests')) { data = { value: [rawPr] }; }
      else if (url.pathname.endsWith('/42')) { data = rawPr; }
      else { data = rawPr.repository; }
      return new Response(JSON.stringify(data));
    };
  });
  await page.getByRole('button', { name: 'Add Source', exact: true }).click();
  await page.getByLabel('Project or repository URL').fill('https://dev.azure.com/prism-tests/Tests/_git/integration');
  await expect(page.getByLabel('ADO authentication')).toHaveValue('azure-cli');
  await page.getByLabel('ADO authentication').selectOption('pat');
  await page.getByLabel('Personal access token', { exact: true }).fill('isolated-test-token');
  await page.getByRole('button', { name: 'Connect Source', exact: true }).click();
  await page.getByRole('heading', { name: 'Mocked integration PR' }).click();
  await expect(page.getByRole('table', { name: 'Diff for /src/example.ts' })).toBeVisible();
  await page.locator('.diff-row.add').hover();
  await page.locator('.diff-row.add').getByRole('button', { name: 'Add finding at 1' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Manual integration finding');
  await page.getByLabel('Finding', { exact: true }).fill('A test finding saved through the isolated desktop IPC service.');
  await page.getByRole('button', { name: 'Save Finding' }).click();
  await expect(page.getByRole('button', { name: 'Manual integration finding' })).toBeVisible();
  await page.getByRole('button', { name: 'Post to PR' }).click();
  await expect(page.getByText('Posted to ADO', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const settings = await window.prism.settings();
    const key = `${settings.sources[0].id}:00000000-0000-4000-8000-000000000001:42`;
    const review = await window.prism.getReview(key);
    await window.prism.postFinding(key, review.findings[0].id);
  });
  expect(await application.evaluate(() => globalThis.prismPostCount)).toBe(1);
  await application.evaluate(() => {
    const subprocess = process.getBuiltinModule('child_process');
    globalThis.prismCliCalls = 0;
    subprocess.execFile = (_file, args, _options, callback) => {
      if (!args.join(' ').includes('account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798')) { throw new Error('Unexpected CLI command in fixture.'); }
      globalThis.prismCliCalls++;
      callback(null, JSON.stringify({ accessToken: 'isolated-cli-token', expires_on: Math.floor(Date.now() / 1000) + 3600 }), '');
      return {};
    };
    const { syncBuiltinESMExports } = process.getBuiltinModule('module');
    syncBuiltinESMExports();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (init?.headers?.Authorization !== 'Bearer isolated-cli-token') { throw new Error('CLI bearer token was not used.'); }
      return previousFetch(input, init);
    };
  });
  const cliSource = await page.evaluate(async () => {
    const settings = await window.prism.addSource({ url: 'https://dev.azure.com/prism-tests/Tests/_git/integration', auth: 'azure-cli', pat: '' });
    const inbox = await window.prism.inbox('active');
    return { method: settings.sources[0].auth, errors: inbox.errors, count: inbox.prs.length };
  });
  expect(cliSource).toEqual({ method: 'azure-cli', errors: [], count: 1 });
  expect(await application.evaluate(() => globalThis.prismCliCalls)).toBe(1);
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  expect(errors).toEqual([]);
  console.log('PASS: desktop startup, isolated IPC, sample, finding edits, dismiss/restore, line jump, command palette, search, responsive layouts, Copilot runtime, encrypted source credential, manual finding persistence, mocked posting, duplicate protection and cached Azure CLI bearer authentication.');
  console.log(`SCREENSHOTS=${screenshots}`);
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}