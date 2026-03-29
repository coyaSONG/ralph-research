import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface TemplateCopyOptions {
  force?: boolean;
}

const packageRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

export function getTemplateRoot(templateName: string): string {
  return join(packageRoot, "templates", templateName);
}

export async function copyTemplate(
  templateName: string,
  targetDir: string,
  options: TemplateCopyOptions = {},
): Promise<{ templateRoot: string; targetDir: string; copiedFiles: string[] }> {
  const templateRoot = getTemplateRoot(templateName);
  const resolvedTargetDir = resolve(targetDir);
  const copiedFiles = await copyDirectoryContents(templateRoot, resolvedTargetDir, options);

  return {
    templateRoot,
    targetDir: resolvedTargetDir,
    copiedFiles,
  };
}

async function copyDirectoryContents(
  sourceDir: string,
  targetDir: string,
  options: TemplateCopyOptions,
  relativeDir = "",
): Promise<string[]> {
  const sourcePath = relativeDir ? join(sourceDir, relativeDir) : sourceDir;
  const entries = await readdir(sourcePath, { withFileTypes: true });
  const copiedFiles: string[] = [];

  for (const entry of entries) {
    const entryRelativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
    const sourceEntryPath = join(sourceDir, entryRelativePath);
    const targetEntryPath = join(targetDir, entryRelativePath);

    if (entry.isDirectory()) {
      await mkdir(targetEntryPath, { recursive: true });
      copiedFiles.push(
        ...(await copyDirectoryContents(sourceDir, targetDir, options, entryRelativePath)),
      );
      continue;
    }

    await mkdir(dirname(targetEntryPath), { recursive: true });
    const exists = await pathExists(targetEntryPath);
    if (exists && !options.force) {
      throw new Error(`Refusing to overwrite ${targetEntryPath}; rerun with --force to replace it`);
    }

    await cp(sourceEntryPath, targetEntryPath, { force: options.force ?? false });
    copiedFiles.push(entryRelativePath.replaceAll("\\", "/"));
  }

  return copiedFiles.sort();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
