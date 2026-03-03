import { listSessions, setSessionsDir } from '../audit/session.js';
import { renderSessionTable } from '../audit/report.js';
import { loadConfig } from '../config/loader.js';

export async function logCommand(): Promise<void> {
  const config = await loadConfig();
  setSessionsDir(config.sessionsDir);
  const sessions = await listSessions();
  console.log(renderSessionTable(sessions));
}
