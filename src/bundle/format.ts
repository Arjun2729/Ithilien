/**
 * Bundle format specification.
 *
 * An .ithilien-bundle is a ZIP archive containing:
 *
 *   metadata.json   — BundleMetadata (format version, session ID, manifest)
 *   session.json    — Full session data with events
 *   manifest.json   — SessionManifest (hash chain, fingerprint, signature)
 *   diffs/          — Individual file diffs from the session
 *     0001-src-auth-ts.patch
 *     0002-package-json.patch
 *     ...
 */

export const BUNDLE_FORMAT_VERSION = 1;
export const BUNDLE_EXTENSION = '.ithilien-bundle';
