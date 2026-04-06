import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { isMissingFileError } from "../../shared/fs-errors.js";

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_GRACE_MS = 30 * 1000;

const lockOwnerSchema = z.object({
  runId: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
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

  await mkdir(dirname(resolvedPath), { recursive: true });
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

  try {
    await writeFile(resolvedPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return { path: resolvedPath, metadata };
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }

  const existing = await readLockMetadata(resolvedPath);
  const stale = await isStaleLock(resolvedPath);
  if (!stale) {
    const heartbeatAgeMs = existing ? Date.now() - Date.parse(existing.updatedAt) : undefined;
    const details = [
      `Active lock already exists at ${resolvedPath}`,
      existing ? `pid=${existing.pid}` : null,
      existing?.owner?.runId ? `runId=${existing.owner.runId}` : null,
      heartbeatAgeMs === undefined ? null : `heartbeatAgeMs=${heartbeatAgeMs}`,
    ].filter(Boolean).join(" ");
    throw new LockAcquisitionError(details, {
      ...(existing ? { metadata: existing } : {}),
      ...(heartbeatAgeMs === undefined ? {} : { heartbeatAgeMs }),
    });
  }

  await rm(resolvedPath, { force: true });
  await writeFile(resolvedPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { path: resolvedPath, metadata };
}

export async function renewLock(path: string, token: string): Promise<LockfileMetadata> {
  const resolvedPath = resolve(path);
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
  await writeFile(resolvedPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

export async function releaseLock(path: string, token?: string): Promise<void> {
  const resolvedPath = resolve(path);
  const metadata = await readLockMetadata(resolvedPath);
  if (!metadata) {
    return;
  }

  if (token && metadata.token !== token) {
    throw new LockAcquisitionError(`Refusing to release lock at ${resolvedPath}: token mismatch`);
  }

  await rm(resolvedPath, { force: true });
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
