import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { takeSnapshot, diffSnapshots } from '../src/audit/fs-watcher.js';

describe('fs-watcher', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ithilien-test-'));
    await writeFile(join(dir, 'file1.txt'), 'hello');
    await writeFile(join(dir, 'file2.txt'), 'world');
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'nested.txt'), 'nested');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('takes a snapshot of all files', async () => {
    const snapshot = await takeSnapshot(dir);
    expect(snapshot.size).toBe(3);
    expect(snapshot.has('file1.txt')).toBe(true);
    expect(snapshot.has('file2.txt')).toBe(true);
    expect(snapshot.has('sub/nested.txt')).toBe(true);
  });

  it('detects created files', async () => {
    const before = await takeSnapshot(dir);
    await writeFile(join(dir, 'file3.txt'), 'new file');
    const changes = await diffSnapshots(before, dir);
    const created = changes.filter((c) => c.type === 'created');
    expect(created).toHaveLength(1);
    expect(created[0].path).toBe('file3.txt');
  });

  it('detects modified files', async () => {
    const before = await takeSnapshot(dir);
    await writeFile(join(dir, 'file1.txt'), 'modified content');
    const changes = await diffSnapshots(before, dir);
    const modified = changes.filter((c) => c.type === 'modified');
    expect(modified).toHaveLength(1);
    expect(modified[0].path).toBe('file1.txt');
  });

  it('detects deleted files', async () => {
    const before = await takeSnapshot(dir);
    await rm(join(dir, 'file2.txt'));
    const changes = await diffSnapshots(before, dir);
    const deleted = changes.filter((c) => c.type === 'deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].path).toBe('file2.txt');
  });

  it('detects no changes when nothing changed', async () => {
    const before = await takeSnapshot(dir);
    const changes = await diffSnapshots(before, dir);
    expect(changes).toHaveLength(0);
  });
});
