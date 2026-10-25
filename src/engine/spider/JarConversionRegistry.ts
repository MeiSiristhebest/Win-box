export type JarConversionStage = 'download' | 'convert';

export interface JarConversionProgress {
  startedAt: number;
  attached: boolean;
  stage: JarConversionStage;
}

export interface JarConversionProgressView extends JarConversionProgress {
  elapsedMs: number;
}

interface ConversionFailure {
  at: number;
  message: string;
}

const CONVERSION_FAILURE_TTL_MS = 120_000;

/** A detached conversion is still running; callers may retry without recording a failure. */
export class ConversionInFlightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionInFlightError';
  }
}

/**
 * Tracks conversion identity, de-duplicates concurrent work, and owns transient
 * progress/failure state. It performs no I/O; callers supply cache validation
 * and the conversion operation through ports.
 */
export class JarConversionRegistry {
  private readonly convertedPaths = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly failures = new Map<string, ConversionFailure>();
  private readonly progress = new Map<string, JarConversionProgress>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  ensure(
    url: string,
    isUsableArtifact: (path: string) => boolean,
    convert: () => Promise<string>,
  ): Promise<string> {
    const cachedPath = this.convertedPaths.get(url);
    if (cachedPath && isUsableArtifact(cachedPath)) return Promise.resolve(cachedPath);
    if (cachedPath) this.convertedPaths.delete(url);

    const failure = this.failure(url);
    if (failure) return Promise.reject(new Error(failure));

    const pending = this.inFlight.get(url);
    if (pending) return pending;

    let task: Promise<string>;
    task = Promise.resolve()
      .then(convert)
      .then((path) => {
        this.convertedPaths.set(url, path);
        this.failures.delete(url);
        return path;
      })
      .catch((error: unknown) => {
        if (!(error instanceof ConversionInFlightError)) {
          this.failures.set(url, { at: this.now(), message: errorMessage(error) });
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlight.get(url) === task) this.inFlight.delete(url);
      });
    this.inFlight.set(url, task);
    return task;
  }

  convertedPath(url: string): string | undefined {
    return this.convertedPaths.get(url);
  }

  hasConvertedPath(url: string): boolean {
    return this.convertedPaths.has(url);
  }

  forgetConvertedPath(url: string): void {
    this.convertedPaths.delete(url);
  }

  pending(url: string): Promise<string> | null {
    return this.inFlight.get(url) ?? null;
  }

  failure(url: string): string {
    const failure = this.failures.get(url);
    if (!failure) return '';
    if (this.now() - failure.at >= CONVERSION_FAILURE_TTL_MS) {
      this.failures.delete(url);
      return '';
    }
    return failure.message;
  }

  startProgressIfAbsent(url: string, progress: JarConversionProgress): void {
    if (!this.progress.has(url)) this.progress.set(url, progress);
  }

  attachToProgress(url: string, startedAt: number): void {
    this.progress.set(url, { startedAt, attached: true, stage: 'convert' });
  }

  setStage(url: string, stage: JarConversionStage): void {
    const current = this.progress.get(url);
    if (current && current.stage !== stage) this.progress.set(url, { ...current, stage });
  }

  clearProgress(url: string): void {
    this.progress.delete(url);
  }

  progressView(url: string): JarConversionProgressView | null {
    const current = this.progress.get(url);
    if (!current) return null;
    return { ...current, elapsedMs: Math.max(0, this.now() - current.startedAt) };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
