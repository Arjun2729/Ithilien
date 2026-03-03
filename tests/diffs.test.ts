import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { takeSnapshot, diffSnapshots, generateDiffs } from '../src/audit/fs-watcher.js';

describe('generateDiffs', () => {
  let beforeDir: string;
  let afterDir: string;

  beforeEach(async () => {
    beforeDir = await mkdtemp(join(tmpdir(), 'ithilien-diff-before-'));
    afterDir = await mkdtemp(join(tmpdir(), 'ithilien-diff-after-'));

    // Set up initial files in both dirs
    await writeFile(join(beforeDir, 'existing.txt'), 'line1\nline2\nline3\n');
    await writeFile(join(afterDir, 'existing.txt'), 'line1\nline2\nline3\n');

    await writeFile(join(beforeDir, 'to-modify.txt'), 'original content\n');
    await writeFile(join(afterDir, 'to-modify.txt'), 'modified content\nnew line\n');

    await writeFile(join(beforeDir, 'to-delete.txt'), 'will be deleted\n');
    // to-delete.txt not in afterDir

    // new-file.txt only in afterDir
    await writeFile(join(afterDir, 'new-file.txt'), 'brand new\n');
  });

  afterEach(async () => {
    await rm(beforeDir, { recursive: true, force: true });
    await rm(afterDir, { recursive: true, force: true });
  });

  it('generates diff for modified files', async () => {
    const before = await takeSnapshot(beforeDir);
    const changes = await diffSnapshots(before, afterDir);
    const enriched = await generateDiffs(beforeDir, afterDir, changes);

    const modified = enriched.find((c) => c.type === 'modified');
    expect(modified).toBeDefined();
    expect(modified!.diff).toContain('-original content');
    expect(modified!.diff).toContain('+modified content');
    expect(modified!.diff).toContain('+new line');
  });

  it('generates diff for created files', async () => {
    const before = await takeSnapshot(beforeDir);
    const changes = await diffSnapshots(before, afterDir);
    const enriched = await generateDiffs(beforeDir, afterDir, changes);

    const created = enriched.find((c) => c.type === 'created');
    expect(created).toBeDefined();
    expect(created!.path).toBe('new-file.txt');
    expect(created!.diff).toContain('/dev/null');
    expect(created!.diff).toContain('+brand new');
  });

  it('generates diff for deleted files', async () => {
    const before = await takeSnapshot(beforeDir);
    const changes = await diffSnapshots(before, afterDir);
    const enriched = await generateDiffs(beforeDir, afterDir, changes);

    const deleted = enriched.find((c) => c.type === 'deleted');
    expect(deleted).toBeDefined();
    expect(deleted!.path).toBe('to-delete.txt');
    expect(deleted!.diff).toContain('/dev/null');
    expect(deleted!.diff).toContain('-will be deleted');
  });

  it('handles all change types in one pass', async () => {
    const before = await takeSnapshot(beforeDir);
    const changes = await diffSnapshots(before, afterDir);
    const enriched = await generateDiffs(beforeDir, afterDir, changes);

    expect(enriched.filter((c) => c.type === 'created')).toHaveLength(1);
    expect(enriched.filter((c) => c.type === 'modified')).toHaveLength(1);
    expect(enriched.filter((c) => c.type === 'deleted')).toHaveLength(1);
    // All enriched entries should have diffs
    for (const change of enriched) {
      expect(change.diff).toBeDefined();
    }
  });
});
