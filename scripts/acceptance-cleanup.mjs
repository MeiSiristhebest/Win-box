/** Bound a cleanup operation so a hung child-process close cannot suppress its report. */
export function withAcceptanceDeadline(operation, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => clearTimeout(timer));
}

export function newProcessIds(before, after) {
  const existing = new Set(before);
  return [...new Set(after)].filter(processId => !existing.has(processId));
}

export function assertNoExistingPotPlayer(processIds) {
  if (processIds.length) {
    throw new Error('PotPlayer is already running; refusing to route the test fixture into the user session.');
  }
  return new Set(processIds);
}

function processIsRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function waitForChildExit(child, timeoutMs) {
  if (!processIsRunning(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    let timer;
    const finish = exited => {
      clearTimeout(timer);
      child.removeListener?.('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once('exit', onExit);
    timer = setTimeout(() => finish(!processIsRunning(child)), timeoutMs);
    if (!processIsRunning(child)) finish(true);
  });
}

/** Close an app and, if needed, terminate only its explicitly owned child process. */
export async function closeOwnedAcceptanceProcess({ child, close, terminate, closeTimeoutMs = 15_000, exitTimeoutMs = 5_000 }) {
  const steps = [];
  try {
    await withAcceptanceDeadline(close, closeTimeoutMs, 'close-electron');
    steps.push({ action: 'close-electron', status: 'PASS' });
  } catch (error) {
    steps.push({ action: 'close-electron', status: 'FAIL', error: String(error) });
  }

  if (!child) return steps;
  if (!processIsRunning(child)) {
    steps.push({ action: 'wait-electron-exit', status: 'PASS' });
    return steps;
  }

  const exitedGracefully = await waitForChildExit(child, exitTimeoutMs);
  if (exitedGracefully) {
    steps.push({ action: 'wait-electron-exit', status: 'PASS' });
    return steps;
  }
  steps.push({ action: 'wait-electron-exit', status: 'FAIL', error: `Acceptance Electron process ${child.pid} did not exit within ${exitTimeoutMs}ms.` });

  try {
    const signaled = terminate();
    if (!signaled && processIsRunning(child)) throw new Error(`Could not terminate acceptance Electron process ${child.pid}.`);
    steps.push({ action: 'terminate-electron-owned-child', status: 'PASS', pid: child.pid });
  } catch (error) {
    steps.push({ action: 'terminate-electron-owned-child', status: 'FAIL', pid: child.pid, error: String(error) });
  }

  const exitedAfterTermination = await waitForChildExit(child, exitTimeoutMs);
  if (exitedAfterTermination) {
    steps.push({ action: 'wait-electron-termination', status: 'PASS', pid: child.pid });
  } else {
    steps.push({ action: 'wait-electron-termination', status: 'FAIL', pid: child.pid, error: `Acceptance Electron process ${child.pid} remained running after targeted termination.` });
  }
  return steps;
}
