/** Maximum retained output from a single cold JVM/Python invocation. */
export const MAX_SPIDER_SUBPROCESS_STDOUT_BYTES = 8 * 1024 * 1024;
export const MAX_SPIDER_SUBPROCESS_STDERR_BYTES = 1 * 1024 * 1024;

/** Serve stdout is a one-JSON-envelope-per-line protocol; escaped payload can exceed the raw result. */
export const MAX_SPIDER_POOL_RESULT_FRAME_BYTES = 16 * 1024 * 1024;

/** Serve stderr is streamed line-by-line to diagnostics and is never retained as a whole. */
export const MAX_SPIDER_POOL_DIAGNOSTIC_LINE_BYTES = 64 * 1024;
