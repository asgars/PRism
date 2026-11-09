import { PublicClientApplication } from '@azure/msal-node';
import { execFile } from 'node:child_process';
import type { Store } from './store';
import type { AuthStep } from '../shared/types';

const scopes = ['499b84ac-1321-427f-aa17-267ca6975798/.default'];

export class AzureCliAuth {
  private cached?: { token: string; expiresAt: number };
  private pending?: Promise<string>;
  token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 120_000) { return Promise.resolve(this.cached.token); }
    return this.pending ??= this.acquire().finally(() => { this.pending = undefined; });
  }
  private async acquire() {
    try {
      const args = ['account', 'get-access-token', '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--output', 'json', '--only-show-errors'];
      const executable = process.platform === 'win32' ? 'cmd.exe' : 'az';
      const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `az ${args.join(' ')}`] : args;
      const output = await new Promise<string>((resolve, reject) => {
        execFile(executable, commandArgs, { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
          if (error) { reject(new Error('Azure CLI token acquisition failed.')); }
          else { resolve(stdout); }
        });
      });
      const result: unknown = JSON.parse(output);
      if (!result || typeof result !== 'object' || !('accessToken' in result) || typeof result.accessToken !== 'string' || !result.accessToken.trim() || !('expires_on' in result)) { throw new Error('Invalid Azure CLI response.'); }
      const expiresAt = Number(result.expires_on) * 1000;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) { throw new Error('Invalid Azure CLI token expiration.'); }
      this.cached = { token: result.accessToken, expiresAt };
      return result.accessToken;
    } catch {
      throw new Error('Azure CLI authentication is unavailable. Install or update Azure CLI, then run az login --use-device-code for the account and tenant that have access to this ADO organization. No Prism app registration is required.');
    }
  }
}

export class EntraAuth {
  private signingIn = false;
  constructor(private store: Store, private notify: (step: AuthStep) => void, private openBrowser: (url: string) => Promise<void>) {}
  private client() {
    const { entraClientId, entraTenantId } = this.store.settings;
    if (!/^[\da-f-]{36}$/i.test(entraClientId) || !/^[\w.-]+$/.test(entraTenantId)) {
      throw new Error('Configure an approved Entra public-client application ID and tenant in Settings, or use an ADO PAT.');
    }
    return new PublicClientApplication({
      auth: { clientId: entraClientId, authority: `https://login.microsoftonline.com/${entraTenantId}` },
      cache: { cachePlugin: {
        beforeCacheAccess: async (context) => { const cache = this.store.secret(`msal:${entraClientId}:${entraTenantId}`); if (cache) { context.tokenCache.deserialize(cache); } },
        afterCacheAccess: async (context) => { if (context.cacheHasChanged) { this.store.setSecret(`msal:${entraClientId}:${entraTenantId}`, context.tokenCache.serialize()); } },
      } },
    });
  }
  async login(method: 'browser' | 'device-code' = 'browser') {
    if (this.signingIn) { throw new Error('Microsoft sign-in is already in progress.'); }
    this.signingIn = true;
    try {
      const client = this.client();
      const result = method === 'device-code'
        ? await client.acquireTokenByDeviceCode({ scopes, deviceCodeCallback: (response) => this.notify({ kind: 'device-code', code: response.userCode, url: response.verificationUri, message: response.message }) })
        : await client.acquireTokenInteractive({ scopes, prompt: 'select_account', openBrowser: async (value) => {
          const url = new URL(value);
          if (url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com' || url.username || url.password || url.port) { throw new Error('Microsoft sign-in returned an unexpected browser URL.'); }
          this.notify({ kind: 'browser', message: 'Complete Microsoft sign-in in your browser.' });
          await this.openBrowser(url.href);
        } });
      if (!result) { throw new Error('Microsoft sign-in did not complete.'); }
      this.notify({ kind: 'completed', message: `Connected as ${result.account?.username ?? 'Microsoft account'}` });
    } finally { this.signingIn = false; }
  }
  async token() {
    const client = this.client();
    const accounts = await client.getTokenCache().getAllAccounts();
    if (!accounts[0]) { throw new Error('Sign in to Microsoft in Settings first.'); }
    try { return (await client.acquireTokenSilent({ account: accounts[0], scopes })).accessToken; }
    catch { throw new Error('Microsoft session expired. Sign in again in Settings.'); }
  }
}