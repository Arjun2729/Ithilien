import type { SessionEvent } from '../types.js';

/**
 * Real-time event logger that captures session events as they occur.
 */
export class AuditLogger {
  private events: SessionEvent[] = [];

  log(event: SessionEvent): void {
    this.events.push(event);
  }

  commandStart(command: string): void {
    this.log({ type: 'command_start', timestamp: now(), command });
  }

  commandEnd(exitCode: number): void {
    this.log({ type: 'command_end', timestamp: now(), exitCode });
  }

  fileCreated(path: string, size: number, diff?: string): void {
    this.log({ type: 'file_created', timestamp: now(), path, size, diff });
  }

  fileModified(path: string, diff?: string): void {
    this.log({ type: 'file_modified', timestamp: now(), path, diff });
  }

  fileDeleted(path: string, diff?: string): void {
    this.log({ type: 'file_deleted', timestamp: now(), path, diff });
  }

  networkRequest(destination: string, allowed: boolean): void {
    this.log({ type: 'network_request', timestamp: now(), destination, allowed });
  }

  packageInstalled(manager: string, name: string, version: string): void {
    this.log({ type: 'package_installed', timestamp: now(), manager, name, version });
  }

  guardrailTriggered(rule: string, action: string, detail: string): void {
    this.log({ type: 'guardrail_triggered', timestamp: now(), rule, action, detail });
  }

  stdout(data: string): void {
    this.log({ type: 'stdout', timestamp: now(), data });
  }

  stderr(data: string): void {
    this.log({ type: 'stderr', timestamp: now(), data });
  }

  getEvents(): SessionEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

function now(): string {
  return new Date().toISOString();
}
