import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraAuth, AzureCliAuth } from '../src/main/auth';
import type { Store } from '../src/main/store';

const msal = vi.hoisted(() => ({ client: vi.fn(), interactive: vi.fn(), device: vi.fn() }));
const cli = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('@azure/msal-node', () => ({ PublicClientApplication: msal.client }));
vi.mock('node:child_process', () => ({ execFile: cli.execFile }));
const authorizationUrl = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=test';

function fixture(clientId = '00000000-0000-4000-8000-000000000001') {
  const store = { settings: { entraClientId: clientId, entraTenantId: 'organizations' }, secret: vi.fn(), setSecret: vi.fn() } as unknown as Store;
  const notify = vi.fn(); const openBrowser = vi.fn().mockResolvedValue(undefined);
  return { auth: new EntraAuth(store, notify, openBrowser), notify, openBrowser };
}
beforeEach(() => {
  vi.resetAllMocks();
  msal.client.mockImplementation(function () { return { acquireTokenInteractive: msal.interactive, acquireTokenByDeviceCode: msal.device }; });
  msal.interactive.mockImplementation(async (request) => { await request.openBrowser(authorizationUrl); return { account: { username: 'test@example.com' } }; });
  msal.device.mockImplementation(async (request) => {
    request.deviceCodeCallback({ userCode: 'TEST-CODE', verificationUri: 'https://microsoft.com/devicelogin', message: 'Enter the code.' });
    return { account: { username: 'test@example.com' } };
  });
});

describe('Microsoft sign-in', () => {
  it('uses the system-browser flow by default and reports completion without exposing tokens', async () => {
    const { auth, notify, openBrowser } = fixture();
    await auth.login();
    expect(msal.interactive).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['499b84ac-1321-427f-aa17-267ca6975798/.default'], prompt: 'select_account' }));
    expect(openBrowser).toHaveBeenCalledWith(authorizationUrl);
    expect(msal.device).not.toHaveBeenCalled();
    expect(notify.mock.calls.map(([step]) => step.kind)).toEqual(['browser', 'completed']);
    expect(notify).toHaveBeenLastCalledWith({ kind: 'completed', message: 'Connected as test@example.com' });
  });
  it('keeps device-code authentication as an explicit fallback', async () => {
    const { auth, notify, openBrowser } = fixture();
    await auth.login('device-code');
    expect(msal.interactive).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'device-code', code: 'TEST-CODE' }));
  });
  it('requires an approved registration before starting authentication', async () => {
    await expect(fixture('').auth.login()).rejects.toThrow('approved Entra public-client');
    expect(msal.client).not.toHaveBeenCalled();
  });
  it('rejects unexpected browser destinations', async () => {
    msal.interactive.mockImplementation(async (request) => request.openBrowser('https://untrusted.example/authorize'));
    const { auth, openBrowser } = fixture();
    await expect(auth.login()).rejects.toThrow('unexpected browser URL');
    expect(openBrowser).not.toHaveBeenCalled();
  });
  it('surfaces browser launch failure and allows a later explicit fallback', async () => {
    const { auth, openBrowser } = fixture();
    openBrowser.mockRejectedValueOnce(new Error('Browser launch failed'));
    await expect(auth.login()).rejects.toThrow('Browser launch failed');
    expect(msal.device).not.toHaveBeenCalled();
    await expect(auth.login('device-code')).resolves.toBeUndefined();
  });
  it('blocks simultaneous sign-in attempts', async () => {
    let finish!: (value: unknown) => void;
    msal.interactive.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { auth } = fixture();
    const pending = auth.login();
    await expect(auth.login()).rejects.toThrow('already in progress');
    finish({ account: { username: 'test@example.com' } });
    await pending;
    await expect(auth.login('device-code')).resolves.toBeUndefined();
  });
});

describe('Azure CLI authentication', () => {
  function respond(output: unknown = { accessToken: 'isolated-cli-token', expires_on: Math.floor(Date.now() / 1000) + 3600 }) {
    cli.execFile.mockImplementation((_executable, _args, _options, callback) => callback(null, JSON.stringify(output)));
  }
  it('requests the ADO resource with fixed arguments and keeps tokens in main-process memory', async () => {
    respond();
    const auth = new AzureCliAuth();
    await expect(auth.token()).resolves.toBe('isolated-cli-token');
    const [executable, args, options] = cli.execFile.mock.calls[0];
    expect(executable).toBe(process.platform === 'win32' ? 'cmd.exe' : 'az');
    expect(args.join(' ')).toContain('account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798');
    expect(options).toMatchObject({ timeout: 30_000, windowsHide: true });
    await expect(auth.token()).resolves.toBe('isolated-cli-token');
    expect(cli.execFile).toHaveBeenCalledTimes(1);
  });
  it('shares in-flight acquisition across simultaneous ADO requests', async () => {
    respond();
    const auth = new AzureCliAuth();
    expect(await Promise.all([auth.token(), auth.token(), auth.token()])).toEqual(['isolated-cli-token', 'isolated-cli-token', 'isolated-cli-token']);
    expect(cli.execFile).toHaveBeenCalledTimes(1);
  });
  it('refreshes near-expiry tokens rather than retaining them for subsequent requests', async () => {
    respond({ accessToken: 'near-expiry-token', expires_on: Math.floor(Date.now() / 1000) + 60 });
    const auth = new AzureCliAuth();
    await auth.token();
    respond();
    await expect(auth.token()).resolves.toBe('isolated-cli-token');
    expect(cli.execFile).toHaveBeenCalledTimes(2);
  });
  it('sanitizes CLI failures and permits a retry after the user signs in', async () => {
    cli.execFile.mockImplementation((_executable, _args, _options, callback) => callback(new Error('secret diagnostic token')));
    const auth = new AzureCliAuth();
    await expect(auth.token()).rejects.toThrow('az login --use-device-code');
    await expect(auth.token()).rejects.not.toThrow('secret diagnostic token');
    respond();
    await expect(auth.token()).resolves.toBe('isolated-cli-token');
  });
  it.each([
    { accessToken: 'sensitive-token', expires_on: 'invalid' },
    { accessToken: 'sensitive-token', expires_on: 0 },
    { expires_on: 9999999999 },
  ])('rejects invalid responses without exposing their contents', async (output) => {
    respond(output);
    await expect(new AzureCliAuth().token()).rejects.toThrow('No Prism app registration is required');
  });
  it('sanitizes invalid JSON instead of echoing token output', async () => {
    cli.execFile.mockImplementation((_executable, _args, _options, callback) => callback(null, 'sensitive-token'));
    await expect(new AzureCliAuth().token()).rejects.not.toThrow('sensitive-token');
  });
});