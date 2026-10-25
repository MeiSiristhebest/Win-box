import { client } from '../../../api/client';
import type {
  LocalSourceImportPort,
  SubscriptionImportJobMemoryPort,
  SubscriptionImportJobsPort,
} from '../application/subscriptionImportPorts';

const ACTIVE_JOB_KEY = 'winbox:subscription-import-job';

export const subscriptionImportJobsAdapter: SubscriptionImportJobsPort = {
  onProgress: listener => client.onSubscriptionImportProgress(listener),
  listJobs: () => client.cfgListSubscriptionImports(),
  startJob: (url, name) => client.cfgStartSubscriptionImport(url, name),
  cancelJob: jobId => client.cfgCancelSubscriptionImport(jobId),
  retryFailed: jobId => client.cfgRetryFailedSubscriptionImport(jobId),
  continuePending: jobId => client.cfgContinueSubscriptionImport(jobId),
  resumeInterrupted: jobId => client.cfgResumeSubscriptionImport(jobId),
};

export const localSourceImportAdapter: LocalSourceImportPort = {
  importJsonFile: name => client.cfgImportJsonLocal(name),
  importPythonFiles: () => client.cfgImportPyLocal(),
  importPackage: (name, root) => client.cfgImportPackage(name, root),
  importLiveFile: args => client.cfgImportLiveLocal(args),
};

export const browserSubscriptionImportJobMemory: SubscriptionImportJobMemoryPort = {
  readJobId: () => {
    try { return globalThis.sessionStorage?.getItem(ACTIVE_JOB_KEY) ?? ''; }
    catch { return ''; }
  },
  rememberJobId: jobId => {
    try { globalThis.sessionStorage?.setItem(ACTIVE_JOB_KEY, jobId); }
    catch { /* Session storage is optional in restricted renderer contexts. */ }
  },
  forgetJobId: () => {
    try { globalThis.sessionStorage?.removeItem(ACTIVE_JOB_KEY); }
    catch { /* Session storage is optional in restricted renderer contexts. */ }
  },
};
