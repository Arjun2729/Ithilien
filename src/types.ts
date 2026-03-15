// ===== Core Configuration =====

export interface IthilienConfig {
  defaultProfile: string;
  sessionsDir: string;
  approvalServer: {
    port: number;
    timeout: number; // seconds to wait for approval before auto-deny
  };
}

// ===== Guardrail Profiles =====

export interface GuardrailProfile {
  name: string;
  description: string;
  filesystem: {
    readOnlyPaths: string[];
    blockedPaths: string[];
    protectedFilePatterns: string[];
  };
  network: {
    mode: 'none' | 'allowlist' | 'full';
    allowlist: string[];
  };
  resources: {
    cpuLimit: string;
    memoryLimit: string;
    maxDuration: number;
  };
  git: {
    allowCommit: boolean;
    allowPush: boolean;
    allowForce: boolean;
  };
}

// ===== Session & Audit =====

export interface Session {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'killed' | 'denied';
  command: string;
  /** If --agent was used, the original user prompt before wrapper expansion */
  prompt?: string;
  /** If --agent was used, the agent wrapper name */
  agent?: string;
  profile: string;
  projectPath: string;
  exitCode?: number;
  events: SessionEvent[];
  summary?: SessionSummary;
  manifest?: SessionManifest;
}

export type SessionEvent =
  | { type: 'command_start'; timestamp: string; command: string }
  | { type: 'command_end'; timestamp: string; exitCode: number }
  | { type: 'file_created'; timestamp: string; path: string; size: number; diff?: string }
  | { type: 'file_modified'; timestamp: string; path: string; diff?: string }
  | { type: 'file_deleted'; timestamp: string; path: string; diff?: string }
  | { type: 'network_request'; timestamp: string; destination: string; allowed: boolean }
  | { type: 'package_installed'; timestamp: string; manager: string; name: string; version: string }
  | { type: 'guardrail_triggered'; timestamp: string; rule: string; action: string; detail: string }
  | { type: 'policy_decision'; timestamp: string; command: string; action: string; risk: string; category: string; rule: string | null; source: string; reason: string }
  | { type: 'stdout'; timestamp: string; data: string }
  | { type: 'stderr'; timestamp: string; data: string };

export interface SessionSummary {
  duration: number;
  filesCreated: number;
  filesModified: number;
  filesDeleted: number;
  commandsExecuted: number;
  guardrailsTriggered: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
}

// ===== Remote Approval =====

export interface ApprovalRequest {
  id: string;
  timestamp: string;
  tool: string;
  description: string;
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  respondedAt?: string;
}

export interface ApprovalServerConfig {
  port: number;
  authToken: string;
  timeout: number;
  tunnel: boolean;
}

// ===== Integrity & Signing =====

export interface EventHash {
  eventIndex: number;
  eventHash: string;
  previousHash: string;
  chainHash: string;
}

export interface EnvironmentFingerprint {
  dockerImageId: string;
  dockerImageTag: string;
  agentCommand: string;
  hostOS: string;
  nodeVersion: string;
  ithilienVersion: string;
  guardrailProfile: string;
  profileHash: string;
  networkMode: string;
  networkAllowlist: string[];
  capturedAt: string;
}

export interface PolicyContext {
  /** Which policy sources contributed rules (e.g., ['default-policy', 'project-policy']) */
  sources: string[];
  /** SHA-256 hash of the final merged PolicyFile (deterministic JSON) */
  policyHash: string;
  /** Explicit --policy path, if used */
  policyPath?: string;
  /** Ithilien version that ran the policy engine */
  engineVersion: string;
  /** Hash algorithm used for policyHash (e.g., 'sha256') */
  hashAlgorithm?: string;
}

export interface SessionManifest {
  version: 1;
  sessionId: string;
  rootHash: string;
  eventCount: number;
  firstEventAt: string;
  lastEventAt: string;
  fingerprint: EnvironmentFingerprint;
  eventHashes: EventHash[];
  policyContext?: PolicyContext;
  signature?: string;
  publicKey?: string;
}

export interface VerificationResult {
  valid: boolean;
  sessionId: string;
  rootHash: string;
  eventCount: number;
  brokenChainAt?: number;
  signatureValid?: boolean;
  details: string;
}

export interface VerificationReport {
  schemaVersion: 1;
  valid: boolean;
  sessionId: string;
  sessionStatus: string;
  rootHash: string;
  chain: {
    intact: boolean;
    eventCount: number;
    brokenAt?: number;
  };
  signature: {
    present: boolean;
    valid?: boolean;
  };
  policy?: {
    sources: string[];
    policyHash: string;
    policyPath?: string;
    engineVersion: string;
    hashAlgorithm?: string;
  };
  environment: {
    dockerImageTag: string;
    dockerImageId: string;
    guardrailProfile: string;
    networkMode: string;
    ithilienVersion: string;
  };
  events: {
    total: number;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  timing: {
    firstEvent: string;
    lastEvent: string;
  };
  details: string;
}

// ===== Event Metadata =====

/**
 * Broad category for filtering and grouping events.
 */
export type EventCategory = 'lifecycle' | 'filesystem' | 'network' | 'package' | 'enforcement' | 'policy' | 'output';

/**
 * Severity level for event significance.
 */
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Classify a session event by category and severity.
 * Pure function — used for filtering, reporting, and display.
 */
export function categorizeEvent(event: SessionEvent): { category: EventCategory; severity: EventSeverity } {
  switch (event.type) {
    case 'command_start':
    case 'command_end':
      return { category: 'lifecycle', severity: 'info' };
    case 'file_created':
    case 'file_modified':
    case 'file_deleted':
      return { category: 'filesystem', severity: 'info' };
    case 'network_request':
      return { category: 'network', severity: event.allowed ? 'info' : 'warning' };
    case 'package_installed':
      return { category: 'package', severity: 'info' };
    case 'guardrail_triggered':
      return { category: 'enforcement', severity: event.action === 'deny' ? 'error' : 'warning' };
    case 'policy_decision':
      if (event.action === 'deny') return { category: 'policy', severity: 'error' };
      if (event.action === 'ask') return { category: 'policy', severity: 'warning' };
      if (event.risk === 'critical' || event.risk === 'high') return { category: 'policy', severity: 'warning' };
      return { category: 'policy', severity: 'info' };
    case 'stdout':
      return { category: 'output', severity: 'info' };
    case 'stderr':
      return { category: 'output', severity: 'warning' };
  }
}

// ===== Bundle Format =====

export interface BundleMetadata {
  formatVersion: 1;
  bundledAt: string;
  bundledBy: string;
  sessionId: string;
  manifest: SessionManifest;
}
