import { useCallback, useEffect, useState } from 'react';

interface PlayerCommand {
  type: string;
}

/** Owns the transient user feedback shown when a playback command fails. */
export function usePlayerCommandFeedback() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const report = useCallback((command: PlayerCommand, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    setMessage(`操作 ${command.type} 失败：${detail.slice(0, 140)}`);
  }, []);

  return { message, report };
}
