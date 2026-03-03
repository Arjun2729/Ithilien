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
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'killed';
  command: string;
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

export interface SessionManifest {
  version: 1;
  sessionId: string;
  rootHash: string;
  eventCount: number;
  firstEventAt: string;
  lastEventAt: string;
  fingerprint: EnvironmentFingerprint;
  eventHashes: EventHash[];
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

// ===== Bundle Format =====

export interface BundleMetadata {
  formatVersion: 1;
  bundledAt: string;
  bundledBy: string;
  sessionId: string;
  manifest: SessionManifest;
}
