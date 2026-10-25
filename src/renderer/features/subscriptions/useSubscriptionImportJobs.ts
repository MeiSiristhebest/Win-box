import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SubscriptionImportProgressEvent } from '../../../shared/types';
import type { SubscriptionImportJobMemoryPort, SubscriptionImportJobsPort } from './application/subscriptionImportPorts';

interface SubscriptionImportJobsOptions {
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setName: Dispatch<SetStateAction<string>>;
  name: string;
  onRefresh: () => Promise<void>;
  importer: SubscriptionImportJobsPort;
  jobMemory: SubscriptionImportJobMemoryPort;
}

/** Owns background job tracking and resume/cancel commands for URL imports. */
export function useSubscriptionImportJobs({
  setBusy,
  setError,
  setName,
  name,
  onRefresh,
  importer,
  jobMemory,
}: SubscriptionImportJobsOptions) {
  const [url, setUrl] = useState('');
  const [job, setJob] = useState<SubscriptionImportProgressEvent | null>(null);
  const [jobHidden, setJobHidden] = useState(false);
  const jobIdRef = useRef('');
  const importRunning = job?.state === 'resolving' || job?.state === 'running';

  useEffect(() => {
    let mounted = true;
    const preferredJobId = jobMemory.readJobId() || jobIdRef.current;
    if (preferredJobId) jobIdRef.current = preferredJobId;
    const unsubscribe = importer.onProgress((event) => {
      if (event.jobId !== jobIdRef.current) return;
      setJob(previous => previous?.jobId === event.jobId && previous.revision > event.revision ? previous : event);
      if (['completed', 'partial', 'failed', 'cancelled'].includes(event.state)) {
        void onRefresh().catch(error => setError(messageOf(error)));
      }
    });

    void importer.listJobs().then(jobs => {
      if (!mounted) return;
      if (jobIdRef.current && jobIdRef.current !== preferredJobId) return;
      const nextJob = (preferredJobId ? jobs.find(item => item.jobId === preferredJobId) : null) ?? jobs[0] ?? null;
      if (nextJob) {
        jobIdRef.current = nextJob.jobId;
        setJob(previous => previous?.jobId === nextJob.jobId && previous.revision > nextJob.revision ? previous : nextJob);
        jobMemory.rememberJobId(nextJob.jobId);
      } else {
        jobIdRef.current = '';
        jobMemory.forgetJobId();
      }
    }).catch(error => {
      if (mounted) setError(messageOf(error));
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [importer, jobMemory, onRefresh, setError]);

  async function startSubscriptionImport(importUrl: string, importName?: string, clearName = false) {
    setBusy(true);
    setError('');
    try {
      const nextJob = await importer.startJob(importUrl, importName);
      jobIdRef.current = nextJob.jobId;
      jobMemory.rememberJobId(nextJob.jobId);
      setJob(nextJob);
      setJobHidden(false);
      if (clearName) setName('');
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function importUrl() {
    await startSubscriptionImport(url.trim(), name.trim() || undefined, true);
  }

  async function cancelImport() {
    if (!job || !importRunning) return;
    try { setJob(await importer.cancelJob(job.jobId)); }
    catch (error) { setError(messageOf(error)); }
  }

  async function resumeImport(action: 'failed' | 'pending') {
    if (!job || importRunning) return;
    setBusy(true);
    setError('');
    try {
      const nextJob = action === 'failed'
        ? await importer.retryFailed(job.jobId)
        : await importer.continuePending(job.jobId);
      jobIdRef.current = nextJob.jobId;
      jobMemory.rememberJobId(nextJob.jobId);
      setJob(nextJob);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function resumeInterruptedImport() {
    if (!job || importRunning || job.state !== 'interrupted') return;
    setBusy(true);
    setError('');
    try {
      const nextJob = await importer.resumeInterrupted(job.jobId);
      jobIdRef.current = nextJob.jobId;
      jobMemory.rememberJobId(nextJob.jobId);
      setJob(nextJob);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    url,
    setUrl,
    job,
    jobHidden,
    setJobHidden,
    importRunning,
    importUrl,
    startSubscriptionImport,
    cancelImport,
    resumeImport,
    resumeInterruptedImport,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
