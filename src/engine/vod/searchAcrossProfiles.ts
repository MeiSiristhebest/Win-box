// Profile-level search coordination; source execution remains supplied by the host.
import type { SearchAllProgressEvent, SearchAllReport } from '../../shared/types';
import { mergeSearchReports } from './aggSearch';

export interface ProfileWorkerBudget {
  acquire(profileId: string, signal: AbortSignal): Promise<(() => void) | null>;
  finishProfile(profileId: string): void;
}

export type ProfileWorkerBudgetFactory = (
  sourceWorkerLimit: number,
  profileIds: string[],
  initiallyActiveProfileIds: string[],
) => ProfileWorkerBudget;

export interface SearchProfileEntry<TContext> {
  profileId: string;
  profileOrder: number;
  profileName: string;
  context: TContext;
  total: number;
}

export interface MultiProfileSearchOptions<TContext> {
  term: string;
  profiles: readonly SearchProfileEntry<TContext>[];
  profileWorkerLimit: number;
  sourceWorkerLimit: number;
  createWorkerBudget: ProfileWorkerBudgetFactory;
  signal?: AbortSignal;
  onProgress?: (event: SearchAllProgressEvent) => void;
  searchProfile: (
    profile: SearchProfileEntry<TContext>,
    onProgress: (event: SearchAllProgressEvent) => void,
    workerBudget: ProfileWorkerBudget,
    signal: AbortSignal,
  ) => Promise<SearchAllReport>;
}

export async function searchAcrossProfiles<TContext>(options: MultiProfileSearchOptions<TContext>): Promise<SearchAllReport> {
  const { term, profiles, profileWorkerLimit, sourceWorkerLimit, createWorkerBudget, onProgress, searchProfile, signal } = options;
  const total = profiles.reduce((count, profile) => count + profile.total, 0);
  const doneByProfile = new Map(profiles.map((profile) => [profile.profileId, 0]));
  const reports: Array<{ profileId: string; profileName: string; report: SearchAllReport } | null> =
    Array.from({ length: profiles.length }, () => null);
  const overallDone = (): number => [...doneByProfile.values()].reduce((sum, done) => sum + done, 0);
  const forwardProgress = (profile: SearchProfileEntry<TContext>, event?: SearchAllProgressEvent): void => {
    if (!onProgress) return;
    if (event) {
      const localDone = Math.min(profile.total, Math.max(0, event.done));
      doneByProfile.set(profile.profileId, Math.max(doneByProfile.get(profile.profileId) ?? 0, localDone));
    }
    const source = event?.source
      ? {
          ...event.source,
          profileId: profile.profileId,
          profileName: profile.profileName,
          items: event.source.items?.map((item) => ({
            ...item,
            sourceRef: { profileId: profile.profileId, key: event.source!.key },
          })),
        }
      : undefined;
    const done = overallDone();
    try {
      onProgress({
        ...(event ?? { wd: term }),
        wd: term,
        profileId: profile.profileId,
        profileName: profile.profileName,
        profileOrder: profile.profileOrder,
        sourceOrder: event?.sourceOrder,
        ...(source ? { source } : {}),
        done,
        total,
        pending: Math.max(0, total - done),
      });
    } catch { /* Progress listeners cannot fail search work. */ }
  };

  const workerCount = Math.min(profileWorkerLimit, profiles.length);
  const cancellation = new AbortController();
  const workerBudget = createWorkerBudget(
    sourceWorkerLimit,
    profiles.map((profile) => profile.profileId),
    profiles.slice(0, workerCount).map((profile) => profile.profileId),
  );
  const cancelFromCaller = (): void => cancellation.abort(signal?.reason ?? new Error('搜索已取消'));
  signal?.addEventListener('abort', cancelFromCaller, { once: true });
  if (signal?.aborted) cancelFromCaller();
  let nextProfile = 0;
  const runWorker = async (): Promise<void> => {
    for (;;) {
      if (cancellation.signal.aborted) return;
      const index = nextProfile++;
      const profile = profiles[index];
      if (!profile) return;
      try {
        const report = await searchProfile(
          profile,
          (event) => { if (!cancellation.signal.aborted) forwardProgress(profile, event); },
          workerBudget,
          cancellation.signal,
        );
        if (cancellation.signal.aborted) return;
        reports[index] = { profileId: profile.profileId, profileName: profile.profileName, report };
        doneByProfile.set(profile.profileId, profile.total);
        forwardProgress(profile);
      } catch (error) {
        if (!cancellation.signal.aborted) cancellation.abort(error);
        throw cancellation.signal.reason ?? error;
      } finally {
        workerBudget.finishProfile(profile.profileId);
      }
    }
  };
  const outcomes = await Promise.allSettled(Array.from({ length: workerCount }, () => runWorker()));
  signal?.removeEventListener('abort', cancelFromCaller);
  const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  if (failed) throw failed.reason;
  return mergeSearchReports(reports.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}
