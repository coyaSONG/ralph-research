import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { isMissingFileError } from "../../shared/fs-errors.js";

const lockfileMetadataSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ttlMs: z.number().int().positive(),
});

export type LockfileMetadata = z.infer<typeof lockfileMetadataSchema>;

export interface AcquireLockOptions {
  ttlMs?: number;
}

export interface LockHandle {
  path: string;
  metadata: LockfileMetadata;
}

export class LockAcquisitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LockAcquisitionError";
  }
}

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

export async function acquireLock(path: string, options: AcquireLockOptions = {}): Promise<LockHandle> {
  const resolvedPath = resolve(path);
  const ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS;

  await mkdir(dirname(resolvedPath), { recursive: true });

  const metadata: LockfileMetadata = {
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ttlMs,
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

  const stale = await isStaleLock(resolvedPath);
  if (!stale) {
    throw new LockAcquisitionError(`Active lock already exists at ${resolvedPath}`);
  }

  await rm(resolvedPath, { force: true });
  await writeFile(resolvedPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { path: resolvedPath, metadata };
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
  const metadata = await readLockMetadata(path);
  if (!metadata) {
    return false;
  }

  const ageMs = Date.now() - Date.parse(metadata.updatedAt);
  if (ageMs > metadata.ttlMs) {
    return true;
  }

  return !isProcessAlive(metadata.pid);
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
