/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ExamCountdownOptions {
  durationSeconds: number;
  onTick: (remainingSeconds: number) => void;
  onExpire: () => void;
  now?: () => number;
  tickMs?: number;
}

export interface ExamCountdown {
  start: () => void;
  stop: () => void;
  /** Re-reads the clock, for when a throttled background tab becomes visible again. */
  sync: () => void;
  getRemainingSeconds: () => number;
  getElapsedSeconds: () => number;
  /** True for the first caller only, so timer expiry and manual submit can't both submit. */
  claimFinish: () => boolean;
}

/**
 * Counts down to a fixed deadline instead of counting ticks, so answering questions,
 * remounts and delayed background timers can't add or lose exam time.
 */
export function createExamCountdown({
  durationSeconds,
  onTick,
  onExpire,
  now = Date.now,
  tickMs = 250,
}: ExamCountdownOptions): ExamCountdown {
  const startedAt = now();
  const deadline = startedAt + durationSeconds * 1000;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let finished = false;

  const getRemainingSeconds = () => Math.max(0, Math.ceil((deadline - now()) / 1000));

  const stop = () => {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;
  };

  const sync = () => {
    if (finished) return;
    const remaining = getRemainingSeconds();
    onTick(remaining);
    if (remaining === 0) {
      stop();
      onExpire();
    }
  };

  return {
    start: () => {
      if (finished || intervalId !== null) return;
      intervalId = setInterval(sync, tickMs);
      sync();
    },
    stop,
    sync,
    getRemainingSeconds,
    getElapsedSeconds: () => Math.min(durationSeconds, Math.max(1, Math.round((now() - startedAt) / 1000))),
    claimFinish: () => {
      if (finished) return false;
      finished = true;
      stop();
      return true;
    },
  };
}
