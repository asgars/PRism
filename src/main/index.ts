import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Store } from './store';
import { Ado } from './ado';
import { Reviewer } from './copilot';
import { AzureCliAuth, EntraAuth } from './auth';
import { assertFresh, findingSchema, prIdentity, threadPayload, validateLocation } from './domain';
import type { PullRequest, Review } from '../shared/types';

let window: BrowserWindow | null = null;
let reviewer: Reviewer | undefined;
const directory = fileURLToPath(new URL('.', import.meta.url));
const keySchema = z.string().min(1).max(500);
const prRef = z.object({ sourceId: z.string().uuid(), repoId: z.string().uuid(), id: z.number().int().positive() });
const locks = new Set<string>();
let reviewCancelled = false;

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(() => {
    const store = new Store(app.getPath('userData'));
    const progress = (text: string) => window?.webContents.send('progress', text);
    const notify = (step: unknown) => window?.webContents.send('authStep', step);
    const entra = new EntraAuth(store, notify, (url) => shell.openExternal(url));
    const azureCli = new AzureCliAuth();
    const ado = new Ado(store, (auth) => auth === 'azure-cli' ? azureCli.token() : entra.token(), progress);
    reviewer = new Reviewer(store, progress, notify);
    const handle = (channel: string, action: (...args: any[]) => unknown) => {
      ipcMain.handle(channel, async (event, ...args) => {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) { throw new Error('Untrusted IPC sender.'); }
        try { return await action(...args); }
        catch (error) { throw new Error(error instanceof Error ? error.message : 'The operation failed.'); }
      });
    };
    handle('settings', () => store.settings);
    handle('saveSettings', (input) => {
      const data = z.object({ model: z.string().max(150), expectedLogin: z.string().max(100), entraClientId: z.string().max(100), entraTenantId: z.string().max(150) }).parse(input);
      store.settings = { ...store.settings, ...data };
      return store.saveSettings();
    });
    handle('addSource', (input) => ado.addSource(z.object({ url: z.string().max(2000), pat: z.string().max(1000), auth: z.enum(['azure-cli', 'pat', 'entra']) }).parse(input)));
    handle('removeSource', (id) => {
      z.string().uuid().parse(id);
      store.settings.sources = store.settings.sources.filter((source) => source.id !== id);
      store.deleteSecret(id);
      return store.saveSettings();
    });
    handle('pickInstructions', async () => {
      const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'], title: 'Choose review instructions' });
      if (!result.canceled && result.filePaths[0] && !store.settings.instructionFolders.includes(result.filePaths[0])) { store.settings.instructionFolders.push(result.filePaths[0]); }
      return store.saveSettings();
    });
    handle('removeInstructions', (folder) => {
      z.string().parse(folder);
      store.settings.instructionFolders = store.settings.instructionFolders.filter((item) => item !== folder);
      return store.saveSettings();
    });
    handle('inbox', (status) => ado.inbox(z.enum(['active', 'completed', 'abandoned', 'all']).parse(status)));
    const parsePr = (input: unknown) => { const parsed = prRef.parse(input); return { ...parsed, key: prIdentity(parsed) } as PullRequest; };
    handle('snapshot', (input) => ado.snapshot(parsePr(input)));
    handle('getReview', (key) => store.review(keySchema.parse(key)));
    handle('runReview', async (input) => {
      const pr = parsePr(input);
      if (locks.has('review')) { throw new Error('A review is already running.'); }
      const previous = store.review(pr.key);
      if (previous?.findings.some((finding) => finding.state === 'uncertain')) { throw new Error('Reconcile uncertain comments before replacing this review.'); }
      locks.add('review');
      reviewCancelled = false;
      try {
        const snapshot = await ado.snapshot(pr);
        if (reviewCancelled) { throw new Error('Review cancelled.'); }
        return await reviewer!.review(snapshot);
      }
      finally { locks.delete('review'); }
    });
    handle('cancelReview', () => { reviewCancelled = true; return reviewer!.cancel(); });
    handle('saveFinding', (key, input) => {
      keySchema.parse(key);
      const snapshot = store.snapshot(key);
      if (!snapshot) { throw new Error('Load this PR before adding a finding.'); }
      const review: Review = store.review(key) ?? { key, sourceCommit: snapshot.pr.sourceCommit, baseCommit: snapshot.pr.baseCommit,
        targetCommit: snapshot.pr.targetCommit, iteration: snapshot.iteration, created: new Date().toISOString(), summary: 'Manual review findings.', instructions: [], warnings: snapshot.warnings, findings: [] };
      const finding = findingSchema.extend({ id: z.string().uuid(), state: z.enum(['draft', 'dismissed']) }).parse(input);
      const original = review.findings.find((item) => item.id === finding.id);
      if (original?.state === 'posted' || original?.state === 'uncertain' || locks.has(key) || locks.has('review')) { throw new Error('This finding cannot be edited.'); }
      assertFresh(review, snapshot);
      validateLocation(finding, snapshot.files);
      if (original) { Object.assign(original, finding); }
      else { review.findings.push(finding); }
      return store.saveReview(review);
    });
    handle('postFinding', async (key, id) => {
      keySchema.parse(key); z.string().uuid().parse(id);
      if (locks.has(key) || locks.has('review')) { throw new Error('Wait for the current operation to finish.'); }
      const review = store.review(key);
      const finding = review?.findings.find((item) => item.id === id);
      const originalSnapshot = store.snapshot(key);
      if (!review || !finding || !originalSnapshot || finding.state === 'dismissed') { throw new Error('Finding is unavailable.'); }
      if (finding.state === 'posted') { return review; }
      locks.add(key);
      try {
        const existing = (await ado.threads(originalSnapshot.pr)).find((thread) => thread.comments.some((comment) => comment.content?.includes(`<!-- prism:${finding.id} -->`)));
        if (existing) { finding.state = 'posted'; finding.threadId = existing.id; return store.saveReview(review); }
        if (finding.state === 'uncertain') { throw new Error('No matching thread is visible yet. Verify the PR in ADO before retrying; Prism will not automatically repeat an uncertain POST.'); }
        const snapshot = await ado.snapshot(originalSnapshot.pr);
        assertFresh(review, snapshot);
        validateLocation(finding, snapshot.files);
        const confirmed = await dialog.showMessageBox(window!, { type: 'question', buttons: ['Cancel', 'Post Comment'], defaultId: 0, cancelId: 0,
          title: 'Post finding to Azure DevOps?', message: `${snapshot.pr.repoName} #${snapshot.pr.id}: ${finding.title}`,
          detail: `${finding.path}:${finding.line} (${finding.side})\n\n${finding.body}\n\nPosted with a GitHub Copilot attribution. This creates a public PR thread.` });
        if (confirmed.response !== 1) { return review; }
        const fresh = await ado.fresh(snapshot.pr);
        if (fresh.sourceCommit !== review.sourceCommit || fresh.targetCommit !== review.targetCommit || fresh.status !== 'active') { throw new Error('The PR changed during confirmation. Review again before posting.'); }
        finding.state = 'uncertain';
        store.saveReview(review);
        const result = await ado.post(snapshot.pr, threadPayload(finding, snapshot.files.find((file) => file.path === finding.path)!, review));
        finding.state = 'posted'; finding.threadId = result.id;
        return store.saveReview(review);
      } finally { locks.delete(key); }
    });
    handle('copilotStatus', () => reviewer!.status());
    handle('copilotLogin', () => reviewer!.login());
    handle('cancelLogin', () => reviewer!.cancelLogin());
    handle('entraLogin', (method) => entra.login(z.enum(['browser', 'device-code']).default('browser').parse(method)));
    handle('openExternal', async (value) => {
      const url = new URL(z.string().max(4000).parse(value));
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'dev.azure.com' || /^[a-z0-9-]+\.visualstudio\.com$/i.test(url.hostname) || ['github.com', 'microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(url.hostname))) { throw new Error('External URL is not allowed.'); }
      await shell.openExternal(url.href);
    });
    window = new BrowserWindow({ width: 1520, height: 980, minWidth: 800, minHeight: 600, title: 'Prism', backgroundColor: '#f6f7f8', icon: join(directory, '../../assets/icon.png'),
      webPreferences: { preload: join(directory, '../preload/index.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) { void window.loadURL(process.env.ELECTRON_RENDERER_URL); }
    else { void window.loadFile(join(directory, '../renderer/index.html')); }
  }).catch((error) => { dialog.showErrorBox('Prism could not start', String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  let stopping = false;
  app.on('before-quit', (event) => {
    if (stopping || !reviewer) { return; }
    event.preventDefault(); stopping = true;
    reviewer.stop().catch(() => undefined).finally(() => app.quit());
  });
}