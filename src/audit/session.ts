import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { nanoid } from 'nanoid';
import type { Session, SessionEvent, SessionSummary } from '../types.js';

const DEFAULT_SESSIONS_DIR = join(homedir(), '.ithilien', 'sessions');
let sessionsDir = DEFAULT_SESSIONS_DIR;

/**
 * Override the sessions directory (e.g. from config).
 */
export function setSessionsDir(dir: string): void {
  sessionsDir = dir;
}

/**
 * Ensure the sessions directory exists.
 */
export async function ensureSessionsDir(): Promise<string> {
  await mkdir(sessionsDir, { recursive: true });
  return sessionsDir;
}

/**
 * Create a new session.
 */
export function createSession(command: string, profile: string, projectPath: string): Session {
  return {
    id: nanoid(12),
    startedAt: new Date().toISOString(),
    status: 'running',
    command,
    profile,
    projectPath,
    events: [],
  };
}

/**
 * Save a session to disk.
 */
export async function saveSession(session: Session): Promise<string> {
  const dir = await ensureSessionsDir();
  const filePath = join(dir, `${session.id}.json`);
  await writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return filePath;
}

/**
 * Load a session by ID.
 */
export async function loadSession(id: string): Promise<Session> {
  const dir = await ensureSessionsDir();
  const filePath = join(dir, `${id}.json`);
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as Session;
}

/**
 * List all sessions, sorted by most recent first.
 */
export async function listSessions(): Promise<Session[]> {
  const dir = await ensureSessionsDir();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const sessions: Session[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, file), 'utf-8');
      sessions.push(JSON.parse(raw) as Session);
    } catch {
      // Skip malformed files
    }
  }

  return sessions.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

/**
 * Compute a summary from session events.
 */
export function computeSummary(session: Session): SessionSummary {
  const start = new Date(session.startedAt).getTime();
  const end = session.completedAt
    ? new Date(session.completedAt).getTime()
    : Date.now();

  let filesCreated = 0;
  let filesModified = 0;
  let filesDeleted = 0;
  let commandsExecuted = 0;
  let guardrailsTriggered = 0;
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;

  for (const event of session.events) {
    switch (event.type) {
      case 'file_created':
        filesCreated++;
        break;
      case 'file_modified':
        filesModified++;
        if (event.diff) {
          const lines = event.diff.split('\n');
          for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) totalLinesAdded++;
            if (line.startsWith('-') && !line.startsWith('---')) totalLinesRemoved++;
          }
        }
        break;
      case 'file_deleted':
        filesDeleted++;
        break;
      case 'command_start':
        commandsExecuted++;
        break;
      case 'guardrail_triggered':
        guardrailsTriggered++;
        break;
    }
  }

  return {
    duration: Math.floor((end - start) / 1000),
    filesCreated,
    filesModified,
    filesDeleted,
    commandsExecuted,
    guardrailsTriggered,
    totalLinesAdded,
    totalLinesRemoved,
  };
}
