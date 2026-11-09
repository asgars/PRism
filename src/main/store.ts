import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Review, Settings, Snapshot } from '../shared/types';

const defaults: Settings = { sources: [], instructionFolders: [], model: 'auto', expectedLogin: '', entraClientId: '', entraTenantId: 'organizations' };

export class Store {
  settings: Settings;
  private secrets: Record<string, string>;
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true });
    this.settings = { ...defaults, ...this.read<Settings>('settings.json', defaults) };
    this.secrets = this.read<Record<string, string>>('credentials.json', {});
  }
  private read<T>(name: string, fallback: T): T {
    const path = join(this.directory, name);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : fallback;
  }
  private write(name: string, value: unknown) {
    const path = join(this.directory, name);
    writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
  saveSettings() { this.write('settings.json', this.settings); return this.settings; }
  secret(key: string) {
    const value = this.secrets[key];
    return value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : undefined;
  }
  setSecret(key: string, value: string) {
    if (!safeStorage.isEncryptionAvailable()) { throw new Error('Windows secure credential storage is unavailable. No credential was saved.'); }
    this.secrets[key] = safeStorage.encryptString(value).toString('base64');
    this.write('credentials.json', this.secrets);
  }
  deleteSecret(key: string) { delete this.secrets[key]; this.write('credentials.json', this.secrets); }
  private reviewName(key: string, suffix: string) { return `${createHash('sha256').update(key).digest('hex')}.${suffix}.json`; }
  review(key: string) { return this.read<Review | null>(this.reviewName(key, 'review'), null); }
  saveReview(review: Review) { this.write(this.reviewName(review.key, 'review'), review); return review; }
  snapshot(key: string) { return this.read<Snapshot | null>(this.reviewName(key, 'snapshot'), null); }
  saveSnapshot(snapshot: Snapshot) { this.write(this.reviewName(snapshot.pr.key, 'snapshot'), snapshot); return snapshot; }
}