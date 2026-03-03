import AdmZip from 'adm-zip';
import type { Session, BundleMetadata } from '../types.js';
import { verifySession } from '../integrity/verifier.js';
import { saveSession } from '../audit/session.js';

/**
 * Import a .ithilien-bundle, verify its integrity, and save to local store.
 */
export async function importBundle(bundlePath: string): Promise<{
  session: Session;
  verified: boolean;
  details: string;
}> {
  const zip = new AdmZip(bundlePath);

  // Extract metadata
  const metadataEntry = zip.getEntry('metadata.json');
  if (!metadataEntry) {
    throw new Error('Invalid bundle: missing metadata.json');
  }
  const metadata: BundleMetadata = JSON.parse(
    metadataEntry.getData().toString('utf-8'),
  );

  // Extract session
  const sessionEntry = zip.getEntry('session.json');
  if (!sessionEntry) {
    throw new Error('Invalid bundle: missing session.json');
  }
  const session: Session = JSON.parse(
    sessionEntry.getData().toString('utf-8'),
  );

  // Ensure manifest is attached
  if (!session.manifest) {
    const manifestEntry = zip.getEntry('manifest.json');
    if (manifestEntry) {
      session.manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
    }
  }

  // Verify integrity
  const result = verifySession(session);
  if (!result.valid) {
    throw new Error(`Bundle integrity check failed: ${result.details}`);
  }

  // Save to local session store
  await saveSession(session);

  return {
    session,
    verified: result.valid,
    details: result.details,
  };
}
