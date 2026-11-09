export type PrStatus = 'active' | 'completed' | 'abandoned' | 'all';
export type Side = 'left' | 'right';
export type AdoAuth = 'azure-cli' | 'pat' | 'entra';
export interface Source {
  id: string;
  organization: string;
  project: string;
  repository?: string;
  label: string;
  auth: AdoAuth;
}
export interface PullRequest {
  key: string;
  sourceId: string;
  id: number;
  title: string;
  description: string;
  status: Exclude<PrStatus, 'all'>;
  draft: boolean;
  author: string;
  created: string;
  repoId: string;
  repoName: string;
  project: string;
  sourceBranch: string;
  targetBranch: string;
  sourceCommit: string;
  targetCommit: string;
  baseCommit: string;
  webUrl: string;
  reviewers: { name: string; vote: number }[];
}
export interface DiffLine { kind: 'add' | 'remove' | 'context'; text: string; oldLine?: number; newLine?: number }
export interface ChangedFile {
  path: string;
  oldPath: string;
  change: string;
  changeTrackingId?: number;
  lines: DiffLine[];
  skipped?: string;
}
export interface Snapshot {
  pr: PullRequest;
  iteration: number;
  files: ChangedFile[];
  warnings: string[];
}
export interface Finding {
  id: string;
  path: string;
  line: number;
  side: Side;
  severity: 'P1' | 'P2' | 'P3';
  title: string;
  body: string;
  state: 'draft' | 'dismissed' | 'posted' | 'uncertain';
  threadId?: number;
}
export interface Review {
  key: string;
  sourceCommit: string;
  baseCommit: string;
  targetCommit: string;
  iteration: number;
  created: string;
  summary: string;
  instructions: string[];
  warnings: string[];
  findings: Finding[];
}
export interface Settings {
  sources: Source[];
  instructionFolders: string[];
  model: string;
  expectedLogin: string;
  entraClientId: string;
  entraTenantId: string;
}
export interface Inbox { prs: PullRequest[]; errors: string[] }
export interface AuthStatus { isAuthenticated: boolean; login?: string; statusMessage?: string }
export interface AuthStep { kind: string; code?: string; url?: string; message?: string }
export interface PrismApi {
  settings(): Promise<Settings>;
  saveSettings(settings: Pick<Settings, 'model' | 'expectedLogin' | 'entraClientId' | 'entraTenantId'>): Promise<Settings>;
  addSource(input: { url: string; pat: string; auth: AdoAuth }): Promise<Settings>;
  removeSource(id: string): Promise<Settings>;
  pickInstructions(): Promise<Settings>;
  removeInstructions(folder: string): Promise<Settings>;
  inbox(status: PrStatus): Promise<Inbox>;
  snapshot(pr: PullRequest): Promise<Snapshot>;
  getReview(key: string): Promise<Review | null>;
  runReview(pr: PullRequest): Promise<Review>;
  cancelReview(): Promise<void>;
  saveFinding(key: string, finding: Finding): Promise<Review>;
  postFinding(key: string, findingId: string): Promise<Review>;
  copilotStatus(): Promise<AuthStatus>;
  copilotLogin(): Promise<AuthStatus>;
  cancelLogin(): Promise<void>;
  entraLogin(method?: 'browser' | 'device-code'): Promise<void>;
  openExternal(url: string): Promise<void>;
  onProgress(callback: (message: string) => void): () => void;
  onAuthStep(callback: (step: AuthStep) => void): () => void;
}