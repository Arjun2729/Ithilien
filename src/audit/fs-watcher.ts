import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';

export interface FileSnapshot {
  path: string;       // relative path
  size: number;
  hash: string;       // md5
}

export interface FileChange {
  type: 'created' | 'modified' | 'deleted';
  path: string;
  size: number;
  diff?: string;      // unified diff for modified files
}

/**
 * Take a snapshot of all files in a directory (recursively).
 * Returns a map of relative path -> FileSnapshot.
 */
export async function takeSnapshot(rootDir: string): Promise<Map<string, FileSnapshot>> {
  const snapshots = new Map<string, FileSnapshot>();
  await walkDir(rootDir, rootDir, snapshots);
  return snapshots;
}

async function walkDir(
  dir: string,
  rootDir: string,
  snapshots: Map<string, FileSnapshot>
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    // Skip common noise directories
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '__pycache__') {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDir(fullPath, rootDir, snapshots);
    } else if (entry.isFile()) {
      try {
        const info = await stat(fullPath);
        const content = await readFile(fullPath);
        const hash = createHash('md5').update(content).digest('hex');
        snapshots.set(relPath, {
          path: relPath,
          size: info.size,
          hash,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
}

/**
 * Compare two snapshots and return the list of changes.
 */
export async function diffSnapshots(
  before: Map<string, FileSnapshot>,
  afterDir: string
): Promise<FileChange[]> {
  const after = await takeSnapshot(afterDir);
  const changes: FileChange[] = [];

  // Check for created and modified files
  for (const [path, afterSnap] of after) {
    const beforeSnap = before.get(path);

    if (!beforeSnap) {
      changes.push({ type: 'created', path, size: afterSnap.size });
    } else if (beforeSnap.hash !== afterSnap.hash) {
      changes.push({ type: 'modified', path, size: afterSnap.size });
    }
  }

  // Check for deleted files
  for (const [path, beforeSnap] of before) {
    if (!after.has(path)) {
      changes.push({ type: 'deleted', path, size: beforeSnap.size });
    }
  }

  return changes;
}

/**
 * Generate unified diffs for changed files.
 */
export async function generateDiffs(
  beforeDir: string,
  afterDir: string,
  changes: FileChange[]
): Promise<FileChange[]> {
  const enriched: FileChange[] = [];

  for (const change of changes) {
    if (change.type === 'modified') {
      try {
        const beforeContent = await readFile(join(beforeDir, change.path), 'utf-8');
        const afterContent = await readFile(join(afterDir, change.path), 'utf-8');
        const diff = createTwoFilesPatch(
          `a/${change.path}`,
          `b/${change.path}`,
          beforeContent,
          afterContent,
          '',
          ''
        );
        enriched.push({ ...change, diff });
      } catch {
        enriched.push(change);
      }
    } else if (change.type === 'created') {
      try {
        const content = await readFile(join(afterDir, change.path), 'utf-8');
        const diff = createTwoFilesPatch(
          `/dev/null`,
          `b/${change.path}`,
          '',
          content,
          '',
          ''
        );
        enriched.push({ ...change, diff });
      } catch {
        enriched.push(change);
      }
    } else if (change.type === 'deleted') {
      try {
        const content = await readFile(join(beforeDir, change.path), 'utf-8');
        const diff = createTwoFilesPatch(
          `a/${change.path}`,
          `/dev/null`,
          content,
          '',
          '',
          ''
        );
        enriched.push({ ...change, diff });
      } catch {
        enriched.push(change);
      }
    } else {
      enriched.push(change);
    }
  }

  return enriched;
}
