import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ImportReport } from '../../../shared/types';
import type { LocalSourceImportPort } from './application/subscriptionImportPorts';

interface LocalSourceImportOptions {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  onRefresh: () => Promise<void>;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  importer: LocalSourceImportPort;
}

/** Owns file/folder selection flows, their prompts, and import result feedback. */
export function useLocalSourceImport({
  busy,
  setBusy,
  setError,
  setNotice,
  onRefresh,
  name,
  setName,
  importer,
}: LocalSourceImportOptions) {
  const [packageNamePrompt, setPackageNamePrompt] = useState<{ root: string; name: string } | null>(null);
  const [liveNamePrompt, setLiveNamePrompt] = useState<{ path: string; name: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  function applyImportResult(result: { report: ImportReport; warnings: string[] }) {
    setReport(result.report);
    setWarnings(result.warnings || []);
  }

  async function importJsonLocal() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await importer.importJsonFile(name.trim() || undefined);
      if (result.ok) {
        if (result.result) applyImportResult(result.result);
        setNotice('已导入本地 .json 订阅：' + (result.name || result.file || ''));
        setName('');
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function importPyLocal() {
    setBusy(true);
    setError('');
    try {
      const result = await importer.importPythonFiles();
      if (result.ok) {
        setReport(null);
        setWarnings([]);
        setError('');
        setNotice('已导入本地 .py 源：' + result.key);
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function importPackage() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await importer.importPackage(name.trim() || undefined);
      if (result.needsName && result.root) {
        const suggestedName = name.trim() || result.root.split(/[\\/]/).filter(Boolean).pop() || 'Python源';
        setPackageNamePrompt({ root: result.root, name: suggestedName });
        return;
      }
      if (result.ok) {
        if (result.result) applyImportResult(result.result);
        setNotice(packageNotice(result));
        setName('');
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError(messageOf(error));
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
      const result = await importer.importPackage(nextName, prompt.root);
      if (result.ok) {
        if (result.result) applyImportResult(result.result);
        setNotice(packageNotice(result));
        setName('');
        setPackageNamePrompt(null);
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function importLiveLocal() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await importer.importLiveFile();
      if (result.needsName && result.path) {
        setLiveNamePrompt({ path: result.path, name: result.name || '直播源' });
        return;
      }
      if (result.ok) {
        setNotice(liveNotice(result));
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError(messageOf(error));
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
      const result = await importer.importLiveFile({ path: prompt.path, name: nextName });
      if (result.ok) {
        setNotice(liveNotice(result));
        setLiveNamePrompt(null);
        await onRefresh();
      } else if (result.error) setError(result.error);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    report,
    warnings,
    packageNamePrompt,
    setPackageNamePrompt,
    liveNamePrompt,
    setLiveNamePrompt,
    importJsonLocal,
    importPyLocal,
    importPackage,
    confirmPackageName,
    importLiveLocal,
    confirmLiveName,
  };
}

function packageNotice(result: Awaited<ReturnType<LocalSourceImportPort['importPackage']>>): string {
  return '已导入本地包：' + (result.name || '') + '（订阅 ' + (result.rel || '') + '，' + (result.sites ?? 0) + ' 个源）'
    + (result.warnings?.length ? '｜提示：' + result.warnings.join('；') : '');
}

function liveNotice(result: Awaited<ReturnType<LocalSourceImportPort['importLiveFile']>>): string {
  return '已导入直播源：' + (result.name || '') + (result.replaced
    ? '（同一文件已更新）'
    : '（直播页线路第 ' + ((result.index ?? 0) + 1) + ' 条，共 ' + (result.total ?? 0) + ' 条）');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
