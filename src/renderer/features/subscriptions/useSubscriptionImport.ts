import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { client } from '../../api/client';
import type { ImportReturn } from '../../api/client';
import type { ImportReport, SubscriptionImportProgressEvent } from '../../../shared/types';

interface UseSubscriptionImportOptions {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  onRefresh: () => Promise<void>;
}

export function useSubscriptionImport({ busy, setBusy, setError, setNotice, onRefresh }: UseSubscriptionImportOptions) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [packageNamePrompt, setPackageNamePrompt] = useState<{ root: string; name: string } | null>(null);
  const [liveNamePrompt, setLiveNamePrompt] = useState<{ path: string; name: string } | null>(null);
  const [job, setJob] = useState<SubscriptionImportProgressEvent | null>(null);
  const [jobHidden, setJobHidden] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const jobIdRef = useRef('');
  const importRunning = job?.state === 'resolving' || job?.state === 'running';

  useEffect(() => {
    let mounted = true;
    let savedJobId = '';
    try {
      savedJobId = sessionStorage.getItem('winbox:subscription-import-job') || '';
    } catch {
      // Session storage may be unavailable in a restricted renderer context.
    }
    const preferredJobId = savedJobId || jobIdRef.current;
    if (savedJobId) jobIdRef.current = savedJobId;
    const unsubscribe = client.onSubscriptionImportProgress((event) => {
      if (event.jobId !== jobIdRef.current) return;
      setJob((previous) => previous?.jobId === event.jobId && previous.revision > event.revision ? previous : event);
      if (['completed', 'partial', 'failed', 'cancelled'].includes(event.state)) {
        void onRefresh().catch((error) => setError((error as Error).message));
      }
    });
    void client.cfgListSubscriptionImports().then((jobs) => {
      if (!mounted) return;
      if (jobIdRef.current && jobIdRef.current !== preferredJobId) return;
      const nextJob = (preferredJobId ? jobs.find((item) => item.jobId === preferredJobId) : null) ?? jobs[0] ?? null;
      if (nextJob) {
        jobIdRef.current = nextJob.jobId;
        setJob((previous) => previous?.jobId === nextJob.jobId && previous.revision > nextJob.revision ? previous : nextJob);
        try { sessionStorage.setItem('winbox:subscription-import-job', nextJob.jobId); } catch { /* renderer session storage is optional */ }
      } else {
        jobIdRef.current = '';
        try { sessionStorage.removeItem('winbox:subscription-import-job'); } catch { /* renderer session storage is optional */ }
      }
    }).catch((error) => {
      if (mounted) setError((error as Error).message);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [onRefresh, setError]);

  function applyImportResult(result: ImportReturn) {
    setReport(result.report);
    setWarnings(result.warnings || []);
  }

  async function startSubscriptionImport(importUrl: string, importName?: string, clearName = false) {
    setBusy(true);
    setError('');
    try {
      const nextJob = await client.cfgStartSubscriptionImport(importUrl, importName);
      jobIdRef.current = nextJob.jobId;
      try { sessionStorage.setItem('winbox:subscription-import-job', nextJob.jobId); } catch { /* renderer session storage is optional */ }
      setJob(nextJob);
      setJobHidden(false);
      if (clearName) setName('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importUrl() {
    await startSubscriptionImport(url.trim(), name.trim() || undefined, true);
  }

  async function cancelImport() {
    if (!job || !importRunning) return;
    try { setJob(await client.cfgCancelSubscriptionImport(job.jobId)); }
    catch (error) { setError((error as Error).message); }
  }

  async function resumeImport(action: 'failed' | 'pending') {
    if (!job || importRunning) return;
    setBusy(true);
    setError('');
    try {
      const nextJob = action === 'failed'
        ? await client.cfgRetryFailedSubscriptionImport(job.jobId)
        : await client.cfgContinueSubscriptionImport(job.jobId);
      jobIdRef.current = nextJob.jobId;
      try { sessionStorage.setItem('winbox:subscription-import-job', nextJob.jobId); } catch { /* renderer session storage is optional */ }
      setJob(nextJob);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resumeInterruptedImport() {
    if (!job || importRunning || job.state !== 'interrupted') return;
    setBusy(true);
    setError('');
    try {
      const nextJob = await client.cfgResumeSubscriptionImport(job.jobId);
      jobIdRef.current = nextJob.jobId;
      try { sessionStorage.setItem('winbox:subscription-import-job', nextJob.jobId); } catch { /* renderer session storage is optional */ }
      setJob(nextJob);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importJsonLocal() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await client.cfgImportJsonLocal(name.trim() || undefined);
      if (result.ok) {
        if (result.result) applyImportResult(result.result);
        setNotice('已导入本地 .json 订阅：' + (result.name || result.file || ''));
        setName('');
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importPyLocal() {
    setBusy(true);
    setError('');
    try {
      const result = await client.cfgImportPyLocal();
      if (result.ok) {
        setReport(null);
        setWarnings([]);
        setError('');
        setNotice('已导入本地 .py 源：' + result.key);
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importPackage() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await client.cfgImportPackage(name.trim() || undefined);
      if (result.needsName && result.root) {
        const suggestedName = name.trim() || result.root.split(/[\\/]/).filter(Boolean).pop() || 'Python源';
        setPackageNamePrompt({ root: result.root, name: suggestedName });
        return;
      }
      if (result.ok) {
        if (result.result) applyImportResult(result.result);
        setNotice('已导入本地包：' + (result.name || '') + '（订阅 ' + (result.rel || '') + '，' + (result.sites ?? 0) + ' 个源）' + (result.warnings?.length ? '｜提示：' + result.warnings.join('；') : ''));
        setName('');
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPackageName() {
    const prompt = packageNamePrompt;
    const nextName = prompt?.name.trim();
    if (!prompt || !nextName || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await client.cfgImportPackage(nextName, prompt.root);
      if (result.ok) {
        if (result.result) applyImportResult(result.result);
        setNotice('已导入本地包：' + (result.name || '') + '（订阅 ' + (result.rel || '') + '，' + (result.sites ?? 0) + ' 个源）' + (result.warnings?.length ? '｜提示：' + result.warnings.join('；') : ''));
        setName('');
        setPackageNamePrompt(null);
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importLiveLocal() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await client.cfgImportLiveLocal();
      if (result.needsName && result.path) {
        setLiveNamePrompt({ path: result.path, name: result.name || '直播源' });
        return;
      }
      if (result.ok) {
        setNotice('已导入直播源：' + (result.name || '') + (result.replaced ? '（同一文件已更新）' : '（直播页线路第 ' + ((result.index ?? 0) + 1) + ' 条，共 ' + (result.total ?? 0) + ' 条）'));
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmLiveName() {
    const prompt = liveNamePrompt;
    const nextName = prompt?.name.trim();
    if (!prompt || !nextName || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await client.cfgImportLiveLocal({ path: prompt.path, name: nextName });
      if (result.ok) {
        setNotice('已导入直播源：' + (result.name || '') + (result.replaced ? '（同一文件已更新）' : '（直播页线路第 ' + ((result.index ?? 0) + 1) + ' 条，共 ' + (result.total ?? 0) + ' 条）'));
        setLiveNamePrompt(null);
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    url, setUrl, name, setName, busy, job, jobHidden, setJobHidden, importRunning, report, warnings,
    packageNamePrompt, setPackageNamePrompt, liveNamePrompt, setLiveNamePrompt,
    importUrl, startSubscriptionImport, cancelImport, resumeImport, resumeInterruptedImport,
    importJsonLocal, importPyLocal, importPackage, confirmPackageName, importLiveLocal, confirmLiveName,
  };
}
