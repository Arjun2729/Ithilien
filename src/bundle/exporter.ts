import archiver from 'archiver';
import { createWriteStream, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Session, BundleMetadata } from '../types.js';
import { BUNDLE_EXTENSION } from './format.js';

function getPackageVersion(): string {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  for (const rel of ['../../package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, rel), 'utf-8'));
      if (pkg.name === 'ithilien') return pkg.version;
    } catch { /* try next */ }
  }
  return 'unknown';
}

/**
 * Export a session as a self-contained .ithilien-bundle ZIP archive.
 */
export async function exportBundle(
  session: Session,
  outputPath: string,
): Promise<string> {
  if (!session.manifest) {
    throw new Error(
      'Cannot export session without a manifest. Run verification first or use a session created with integrity tracking.',
    );
  }

  const bundlePath = outputPath.endsWith(BUNDLE_EXTENSION)
    ? outputPath
    : `${outputPath}/${session.id}${BUNDLE_EXTENSION}`;

  return new Promise((resolve, reject) => {
    const output = createWriteStream(bundlePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(bundlePath));
    archive.on('error', reject);
    archive.pipe(output);

    // Add metadata
    const metadata: BundleMetadata = {
      formatVersion: 1,
      bundledAt: new Date().toISOString(),
      bundledBy: getPackageVersion(),
      sessionId: session.id,
      manifest: session.manifest!,
    };
    archive.append(JSON.stringify(metadata, null, 2), {
      name: 'metadata.json',
    });

    // Add full session
    archive.append(JSON.stringify(session, null, 2), {
      name: 'session.json',
    });

    // Add manifest separately for easy extraction
    archive.append(JSON.stringify(session.manifest, null, 2), {
      name: 'manifest.json',
    });

    // Add diffs as individual patch files
    let diffIndex = 0;
    for (const event of session.events) {
      if (
        (event.type === 'file_modified' ||
          event.type === 'file_created' ||
          event.type === 'file_deleted') &&
        event.diff
      ) {
        const safeName = event.path.replace(/[^a-zA-Z0-9.-]/g, '-');
        const patchName = `diffs/${String(diffIndex).padStart(4, '0')}-${safeName}.patch`;
        archive.append(event.diff, { name: patchName });
        diffIndex++;
      }
    }

    archive.finalize();
  });
}
