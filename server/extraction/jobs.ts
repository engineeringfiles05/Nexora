/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { ExtractionProgress, PipelineResult } from './pipeline.ts';

export interface ExtractionJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: ExtractionProgress;
  result?: PipelineResult;
  error?: string;
  errorStatus?: number;
  createdAt: number;
  finishedAt?: number;
}

/**
 * In-process job store. Large PDFs take minutes with page-image reading, longer than a
 * request should stay open, so the client starts a job and polls it. Jobs live for an
 * hour; a restart loses them (the admin simply runs the extraction again).
 */
export function createJobStore(options: { maxRunning?: number; ttlMs?: number } = {}) {
  const jobs = new Map<string, ExtractionJob>();
  const queue: (() => Promise<void>)[] = [];
  const maxRunning = options.maxRunning ?? 2;
  const ttl = options.ttlMs ?? 60 * 60 * 1000;
  let running = 0;

  const sweep = () => {
    const now = Date.now();
    for (const [id, job] of jobs) if (job.finishedAt && now - job.finishedAt > ttl) jobs.delete(id);
  };

  const pump = () => {
    while (running < maxRunning && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      task().finally(() => {
        running--;
        pump();
      });
    }
  };

  return {
    start(work: (onProgress: (p: ExtractionProgress) => void) => Promise<PipelineResult>): ExtractionJob {
      sweep();
      const job: ExtractionJob = { id: randomUUID(), status: 'queued', progress: { stage: 'Waiting to start', percent: 0 }, createdAt: Date.now() };
      jobs.set(job.id, job);
      queue.push(async () => {
        job.status = 'running';
        try {
          job.result = await work((p) => {
            job.progress = p;
          });
          job.status = 'done';
        } catch (error: any) {
          job.status = 'error';
          job.error = error?.message || 'Extraction failed.';
          job.errorStatus = typeof error?.status === 'number' ? error.status : 500;
        } finally {
          job.finishedAt = Date.now();
        }
      });
      pump();
      return job;
    },
    get(id: string): ExtractionJob | undefined {
      sweep();
      return jobs.get(id);
    },
  };
}
