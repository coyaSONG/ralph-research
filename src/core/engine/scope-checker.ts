import { readFile } from "node:fs/promises";

import { execa } from "execa";

import type { ScopeConfig } from "../manifest/schema.js";

export type DiffStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface DiffEntry {
  path: string;
  status: DiffStatus;
  previousPath?: string;
  addedLines: number;
  deletedLines: number;
  lineDelta: number;
}

export interface DiffSummary {
  entries: DiffEntry[];
  filesChanged: number;
  totalAddedLines: number;
  totalDeletedLines: number;
  totalLineDelta: number;
}

export type ScopeViolationKind = "disallowed_path" | "max_files_changed_exceeded" | "max_line_delta_exceeded";

export interface ScopeViolation {
  kind: ScopeViolationKind;
  message: string;
  path?: string;
  actual: number | string;
  expected: number | string;
}

export interface ScopeCheckResult {
  withinBudget: boolean;
  summary: DiffSummary;
  violations: ScopeViolation[];
  reason: string;
}

export async function collectDiffSummary(workspacePath: string): Promise<DiffSummary> {
  const statusMap = new Map<string, Omit<DiffEntry, "addedLines" | "deletedLines" | "lineDelta">>();
  const numstatMap = new Map<string, { addedLines: number; deletedLines: number }>();

  const statusLines = await readGitLines(workspacePath, ["diff", "--name-status", "--find-renames", "HEAD"]);
  for (const line of statusLines) {
    const parts = line.split("\t").filter(Boolean);
    const statusCode = parts[0];
    if (!statusCode) {
      continue;
    }

    if (statusCode.startsWith("R")) {
      const previousPath = parts[1];
      const path = parts[2];
      if (path && previousPath) {
        statusMap.set(normalizePath(path), {
          path: normalizePath(path),
          previousPath: normalizePath(previousPath),
          status: "renamed",
        });
      }
      continue;
    }

    const path = parts[1];
    if (!path) {
      continue;
    }

    statusMap.set(normalizePath(path), {
      path: normalizePath(path),
      status: parseStatusCode(statusCode),
    });
  }

  const numstatLines = await readGitLines(workspacePath, ["diff", "--numstat", "--find-renames", "HEAD"]);
  for (const line of numstatLines) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const addedLines = parseNumstatValue(parts[0]);
    const deletedLines = parseNumstatValue(parts[1]);
    const path = normalizePath(parts.at(-1) ?? "");
    if (!path) {
      continue;
    }

    numstatMap.set(path, { addedLines, deletedLines });
  }

  const untrackedPaths = await readGitLines(workspacePath, ["ls-files", "--others", "--exclude-standard"]);
  for (const untrackedPath of untrackedPaths) {
    const normalizedPath = normalizePath(untrackedPath);
    const addedLines = await countFileLines(`${workspacePath}/${normalizedPath}`);

    statusMap.set(normalizedPath, {
      path: normalizedPath,
      status: "untracked",
    });
    numstatMap.set(normalizedPath, { addedLines, deletedLines: 0 });
  }

  const entries = [...statusMap.values()]
    .map((entry) => {
      const counts = numstatMap.get(entry.path) ?? { addedLines: 0, deletedLines: 0 };
      return {
        ...entry,
        addedLines: counts.addedLines,
        deletedLines: counts.deletedLines,
        lineDelta: counts.addedLines + counts.deletedLines,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  return buildDiffSummary(entries);
}

export function checkScope(summary: DiffSummary, scope: ScopeConfig): ScopeCheckResult {
  const violations: ScopeViolation[] = [];

  for (const entry of summary.entries) {
    if (!matchesAllowedGlobs(entry.path, scope.allowedGlobs)) {
      violations.push({
        kind: "disallowed_path",
        path: entry.path,
        actual: entry.path,
        expected: scope.allowedGlobs.join(", "),
        message: `path ${entry.path} is outside allowed scope`,
      });
    }
  }

  if (summary.filesChanged > scope.maxFilesChanged) {
    violations.push({
      kind: "max_files_changed_exceeded",
      actual: summary.filesChanged,
      expected: scope.maxFilesChanged,
      message: `changed ${summary.filesChanged} files, limit is ${scope.maxFilesChanged}`,
    });
  }

  if (summary.totalLineDelta > scope.maxLineDelta) {
    violations.push({
      kind: "max_line_delta_exceeded",
      actual: summary.totalLineDelta,
      expected: scope.maxLineDelta,
      message: `line delta ${summary.totalLineDelta} exceeds limit ${scope.maxLineDelta}`,
    });
  }

  return {
    withinBudget: violations.length === 0,
    summary,
    violations,
    reason: violations.length === 0 ? "change budget satisfied" : violations.map((violation) => violation.message).join("; "),
  };
}

export function matchesAllowedGlobs(path: string, allowedGlobs: string[]): boolean {
  const normalizedPath = normalizePath(path);
  return allowedGlobs.some((glob) => {
    const normalizedGlob = normalizePath(glob);
    const variants = normalizedGlob.startsWith("**/") ? [normalizedGlob, normalizedGlob.slice(3)] : [normalizedGlob];
    return variants.some((variant) => compileGlobToRegex(variant).test(normalizedPath));
  });
}

export function buildDiffSummary(entries: DiffEntry[]): DiffSummary {
  return {
    entries,
    filesChanged: entries.length,
    totalAddedLines: entries.reduce((sum, entry) => sum + entry.addedLines, 0),
    totalDeletedLines: entries.reduce((sum, entry) => sum + entry.deletedLines, 0),
    totalLineDelta: entries.reduce((sum, entry) => sum + entry.lineDelta, 0),
  };
}

async function readGitLines(workspacePath: string, args: string[]): Promise<string[]> {
  const { stdout } = await execa("git", ["-C", workspacePath, ...args]);
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function parseStatusCode(statusCode: string): DiffStatus {
  switch (statusCode[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    default:
      return "modified";
  }
}

function parseNumstatValue(rawValue: string | undefined): number {
  if (!rawValue || rawValue === "-") {
    return 0;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function countFileLines(path: string): Promise<number> {
  const content = await readFile(path, "utf8");
  if (!content) {
    return 0;
  }
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function compileGlobToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/::DOUBLE_STAR::/g, ".*");

  return new RegExp(`^${escaped}$`);
}
