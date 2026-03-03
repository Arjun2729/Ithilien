import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { createApprovalServer, generateToken } from '../src/approval/server.js';

async function canBindLocalhost(): Promise<boolean> {
  return await new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(0, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

const canListen = await canBindLocalhost();
const suite = canListen ? describe : describe.skip;

suite('approval server', () => {
  let srv: ReturnType<typeof createApprovalServer> | undefined;

  async function startServer(options: { authToken: string; timeout: number }) {
    srv = createApprovalServer({ port: 0, ...options });
    await srv.start();
    const addr = srv.server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Expected approval server to be bound to a TCP port');
    }
    const port = (addr as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
    if (srv) await srv.stop().catch(() => {});
    srv = undefined;
  });

  it('generates unique auth tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(16);
  });

  it('starts and responds to health check', async () => {
    const baseUrl = await startServer({ authToken: 'test', timeout: 5 });

    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('requires token for claude-approval endpoint', async () => {
    const baseUrl = await startServer({ authToken: 'secret123', timeout: 1 });

    // Without token — should be rejected
    const noTokenRes = await fetch(`${baseUrl}/api/claude-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }),
    });
    expect(noTokenRes.status).toBe(401);

    // With token — should work (will timeout after 1s but 200 response)
    const withTokenRes = await fetch(`${baseUrl}/api/claude-approval?token=secret123`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }),
    });
    expect(withTokenRes.ok).toBe(true);
  });

  it('requires token for all endpoints except health', async () => {
    const baseUrl = await startServer({ authToken: 'secret123', timeout: 5 });

    // /api/requests without token — 401
    const noTokenRes = await fetch(`${baseUrl}/api/requests`);
    expect(noTokenRes.status).toBe(401);

    // With token — works
    const resWithToken = await fetch(`${baseUrl}/api/requests?token=secret123`);
    expect(resWithToken.ok).toBe(true);

    // Web UI without token — 401
    const uiNoToken = await fetch(`${baseUrl}/`);
    expect(uiNoToken.status).toBe(401);

    // Web UI with token — works
    const uiWithToken = await fetch(`${baseUrl}/?token=secret123`);
    expect(uiWithToken.ok).toBe(true);
    const html = await uiWithToken.text();
    expect(html).toContain('Ithilien');
  });

  it('handles claude approval flow end-to-end', async () => {
    const baseUrl = await startServer({ authToken: 'test', timeout: 10 });

    // Submit a Claude hook request with token (non-blocking via Promise.all)
    const hookRequest = fetch(`${baseUrl}/api/claude-approval?token=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        session_id: 'sess1',
        tool_use_id: 'tool1',
      }),
    });

    await new Promise((r) => setTimeout(r, 200));

    // Get pending requests (with token)
    const pendingRes = await fetch(`${baseUrl}/api/requests?token=test`);
    const pending = await pendingRes.json();
    expect(pending).toHaveLength(1);
    expect(pending[0].tool).toBe('Bash');
    expect(pending[0].description).toBe('Run command: npm test');
    expect(pending[0].status).toBe('pending');

    // Approve the request (with token)
    const respondRes = await fetch(
      `${baseUrl}/api/respond/${pending[0].id}?token=test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }
    );
    expect(respondRes.ok).toBe(true);

    // The hook request should now resolve with approval
    const hookRes = await hookRequest;
    const hookData = await hookRes.json();
    expect(hookData.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(hookData.hookSpecificOutput.permissionDecisionReason).toContain('Approved');
  });

  it('auto-denies on timeout', async () => {
    const timeoutSrv = createApprovalServer({ port: 0, authToken: 'test', timeout: 1 });
    await timeoutSrv.start();
    const addr = timeoutSrv.server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Expected approval server to be bound to a TCP port');
    }
    const timeoutPort = (addr as AddressInfo).port;

    try {
      const hookRes = await fetch(`http://127.0.0.1:${timeoutPort}/api/claude-approval?token=test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/test.txt', content: 'test' },
        }),
      });

      const data = await hookRes.json();
      expect(data.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(data.hookSpecificOutput.permissionDecisionReason).toContain('timed out');
    } finally {
      await timeoutSrv.stop();
    }
  });

  it('rejects duplicate responses', async () => {
    const baseUrl = await startServer({ authToken: 'test', timeout: 10 });

    // Submit request with token
    const hookRequest = fetch(`${baseUrl}/api/claude-approval?token=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
    });

    await new Promise((r) => setTimeout(r, 200));

    const pendingRes = await fetch(`${baseUrl}/api/requests?token=test`);
    const pending = await pendingRes.json();
    const id = pending[0].id;

    // First response succeeds
    const first = await fetch(`${baseUrl}/api/respond/${id}?token=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(first.ok).toBe(true);

    // Second response fails with 409
    const second = await fetch(`${baseUrl}/api/respond/${id}?token=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'denied' }),
    });
    expect(second.status).toBe(409);

    await hookRequest;
  });
});
