import { contextBridge, ipcRenderer } from 'electron';
import type { AuthStep, PrismApi } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args);
const api: PrismApi = {
  settings: () => invoke('settings'), saveSettings: (value) => invoke('saveSettings', value),
  addSource: (value) => invoke('addSource', value), removeSource: (id) => invoke('removeSource', id),
  pickInstructions: () => invoke('pickInstructions'), removeInstructions: (folder) => invoke('removeInstructions', folder),
  inbox: (status) => invoke('inbox', status), snapshot: (pr) => invoke('snapshot', pr),
  getReview: (key) => invoke('getReview', key), runReview: (pr) => invoke('runReview', pr), cancelReview: () => invoke('cancelReview'),
  saveFinding: (key, finding) => invoke('saveFinding', key, finding), postFinding: (key, findingId) => invoke('postFinding', key, findingId),
  copilotStatus: () => invoke('copilotStatus'), copilotLogin: () => invoke('copilotLogin'), cancelLogin: () => invoke('cancelLogin'), entraLogin: (method) => invoke('entraLogin', method),
  openExternal: (url) => invoke('openExternal', url),
  onProgress: (callback) => { const listener = (_event: unknown, text: string) => callback(text); ipcRenderer.on('progress', listener); return () => { ipcRenderer.removeListener('progress', listener); }; },
  onAuthStep: (callback) => { const listener = (_event: unknown, step: AuthStep) => callback(step); ipcRenderer.on('authStep', listener); return () => { ipcRenderer.removeListener('authStep', listener); }; },
};
contextBridge.exposeInMainWorld('prism', api);