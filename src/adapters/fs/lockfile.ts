import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { isMissingFileError } from "../../shared/fs-errors.js";

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_GRACE_MS = 30 * 1000;
const LOCK_GUARD_RETRY_MS = 10;
const LOCK_GUARD_TIMEOUT_MS = 15_000;
const LOCK_GUARD_STALE_MS = 10_000;

const lockOwnerSchema = z.object({
  runId: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
});

const lockGuardMetadataSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string().min(1),
  createdAt: z.string().datetime(),
});

const lockfileMetadataSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ttlMs: z.number().int().positive(),
  graceMs: z.number().int().nonnegative().default(DEFAULT_LOCK_GRACE_MS),
  owner: lockOwnerSchema.optional(),
});

export type LockfileMetadata = z.infer<typeof lockfileMetadataSchema>;
type LockGuardMetadata = z.infer<typeof lockGuardMetadataSchema>;

export interface AcquireLockOptions {
  ttlMs?: number;
  graceMs?: number;
  owner?: LockfileMetadata["owner"];
}

export interface LockHandle {
  path: string;
  metadata: LockfileMetadata;
}

export interface LockRuntimeState {
  metadata: LockfileMetadata;
  processAlive: boolean;
  stale: boolean;
  heartbeatAgeMs: number;
}

export class LockAcquisitionError extends Error {
  public readonly metadata: LockfileMetadata | undefined;
  public readonly heartbeatAgeMs: number | undefined;

  public constructor(
    message: string,
    options: {
      metadata?: LockfileMetadata;
      heartbeatAgeMs?: number;
    } = {},
  ) {
    super(message);
    this.name = "LockAcquisitionError";
    this.metadata = options.metadata;
    this.heartbeatAgeMs = options.heartbeatAgeMs;
  }
}

export async function acquireLock(path: string, options: AcquireLockOptions = {}): Promise<LockHandle> {
  const resolvedPath = resolve(path);
  const ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS;
  const graceMs = options.graceMs ?? DEFAULT_LOCK_GRACE_MS;
  const now = new Date().toISOString();

  const metadata: LockfileMetadata = {
    pid: process.pid,
    token: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ttlMs,
    graceMs,
    ...(options.owner ? { owner: options.owner } : {}),
  };

  return withLockfileMutationGuard(resolvedPath, async () => {
    const existingRuntime = await inspectLock(resolvedPath);
    if (!existingRuntime) {
      await writeLockMetadata(resolvedPath, metadata, "wx");
      return { path: resolvedPath, metadata };
    }

    if (!existingRuntime.stale) {
      const details = [
        `Active lock already exists at ${resolvedPath}`,
        `pid=${existingRuntime.metadata.pid}`,
        existingRuntime.metadata.owner?.runId ? `runId=${existingRuntime.metadata.owner.runId}` : null,
        `heartbeatAgeMs=${existingRuntime.heartbeatAgeMs}`,
      ].filter(Boolean).join(" ");
      throw new LockAcquisitionError(details, {
        metadata: existingRuntime.metadata,
        heartbeatAgeMs: existingRuntime.heartbeatAgeMs,
      });
    }

    await rm(resolvedPath, { force: true });
    await writeLockMetadata(resolvedPath, metadata, "wx");
    return { path: resolvedPath, metadata };
  });
}

export async function renewLock(path: string, token: string): Promise<LockfileMetadata> {
  const resolvedPath = resolve(path);

  return withLockfileMutationGuard(resolvedPath, async () => {
    const metadata = await readLockMetadata(resolvedPath);
    if (!metadata) {
      throw new LockAcquisitionError(`Refusing to renew lock at ${resolvedPath}: lock is missing`);
    }

    if (metadata.token !== token) {
      throw new LockAcquisitionError(`Refusing to renew lock at ${resolvedPath}: token mismatch`, {
        metadata,
      });
    }

    const updated: LockfileMetadata = {
      ...metadata,
      updatedAt: new Date().toISOString(),
    };
    await writeLockMetadata(resolvedPath, updated);
    return updated;
  });
}

export async function releaseLock(path: string, token?: string): Promise<void> {
  const resolvedPath = resolve(path);

  await withLockfileMutationGuard(resolvedPath, async () => {
    const metadata = await readLockMetadata(resolvedPath);
    if (!metadata) {
      return;
    }

    if (token && metadata.token !== token) {
      throw new LockAcquisitionError(`Refusing to release lock at ${resolvedPath}: token mismatch`);
    }

    await rm(resolvedPath, { force: true });
  });
}

export async function isStaleLock(path: string): Promise<boolean> {
  const runtime = await inspectLock(path);
  if (!runtime) {
    return false;
  }

  return runtime.stale;
}

export async function inspectLock(path: string): Promise<LockRuntimeState | null> {
  const metadata = await readLockMetadata(path);
  if (!metadata) {
    return null;
  }

  const heartbeatAgeMs = Date.now() - Date.parse(metadata.updatedAt);
  const processAlive = isProcessAlive(metadata.pid);

  return {
    metadata,
    processAlive,
    stale: heartbeatAgeMs > metadata.ttlMs + metadata.graceMs || !processAlive,
    heartbeatAgeMs,
  };
}

export async function readLockMetadata(path: string): Promise<LockfileMetadata | null> {
  const resolvedPath = resolve(path);

  try {
    const raw = await readFile(resolvedPath, "utf8");
    return lockfileMetadataSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeLockMetadata(path: string, metadata: LockfileMetadata, flag?: "wx"): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    ...(flag ? { flag } : {}),
  });
}

async function withLockfileMutationGuard<T>(lockPath: string, callback: () => Promise<T>): Promise<T> {
  const resolvedPath = resolve(lockPath);
  const guardPath = `${resolvedPath}.guard`;
  const guardMetadata: LockGuardMetadata = {
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const deadline = Date.now() + LOCK_GUARD_TIMEOUT_MS;

  await mkdir(dirname(resolvedPath), { recursive: true });

  while (true) {
    try {
      await mkdir(guardPath);
      try {
        await writeFile(getGuardMetadataPath(guardPath), `${JSON.stringify(guardMetadata, null, 2)}\n`, "utf8");
      } catch (error) {
        await rm(guardPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      await removeStaleGuard(guardPath);
      if (Date.now() > deadline) {
        throw new LockAcquisitionError(`Timed out waiting for lock mutation guard at ${guardPath}`);
      }
      await delay(LOCK_GUARD_RETRY_MS);
    }
  }

  try {
    return await callback();
  } finally {
    await removeOwnedGuard(guardPath, guardMetadata.token);
  }
}

async function removeStaleGuard(guardPath: string): Promise<void> {
  try {
    const metadata = await readGuardMetadata(guardPath);
    if (metadata && isProcessAlive(metadata.pid)) {
      return;
    }

    const guardStats = await stat(guardPath);
    if (Date.now() - guardStats.mtimeMs > LOCK_GUARD_STALE_MS) {
      const staleClaimPath = `${guardPath}.stale-${process.pid}-${randomUUID()}`;
      await rename(guardPath, staleClaimPath);
      await rm(staleClaimPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

async function removeOwnedGuard(guardPath: string, token: string): Promise<void> {
  const metadata = await readGuardMetadata(guardPath);
  if (metadata?.token === token) {
    await rm(guardPath, { recursive: true, force: true });
  }
}

async function readGuardMetadata(guardPath: string): Promise<LockGuardMetadata | null> {
  try {
    const raw = await readFile(getGuardMetadataPath(guardPath), "utf8");
    return lockGuardMetadataSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function getGuardMetadataPath(guardPath: string): string {
  return join(guardPath, "owner.json");
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        return false;
      }
      if (code === "EPERM") {
        return true;
      }
    }
    return false;
  }
}
