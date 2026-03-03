import { describe, it, expect, afterEach } from 'vitest';
import { createApprovalServer, generateToken } from '../src/approval/server.js';

describe('approval server', () => {
  let srv: ReturnType<typeof createApprovalServer>;
  const port = 13457;

  afterEach(async () => {
    if (srv) await srv.stop().catch(() => {});
  });

  it('generates unique auth tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(16);
  });

  it('starts and responds to health check', async () => {
    srv = createApprovalServer({ port, authToken: 'test', timeout: 5 });
    await srv.start();

    const res = await fetch(`http://localhost:${port}/health`);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('requires token for claude-approval endpoint', async () => {
    srv = createApprovalServer({ port, authToken: 'secret123', timeout: 1 });
    await srv.start();

    // Without token — should be rejected
    const noTokenRes = await fetch(`http://localhost:${port}/api/claude-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }),
    });
    expect(noTokenRes.status).toBe(401);

    // With token — should work (will timeout after 1s but 200 response)
    const withTokenRes = await fetch(`http://localhost:${port}/api/claude-approval?token=secret123`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }),
    });
    expect(withTokenRes.ok).toBe(true);
  });

  it('requires token for all endpoints except health', async () => {
    srv = createApprovalServer({ port, authToken: 'secret123', timeout: 5 });
    await srv.start();

    // /api/requests without token — 401
    const noTokenRes = await fetch(`http://localhost:${port}/api/requests`);
    expect(noTokenRes.status).toBe(401);

    // With token — works
    const resWithToken = await fetch(`http://localhost:${port}/api/requests?token=secret123`);
    expect(resWithToken.ok).toBe(true);

    // Web UI without token — 401
    const uiNoToken = await fetch(`http://localhost:${port}/`);
    expect(uiNoToken.status).toBe(401);

    // Web UI with token — works
    const uiWithToken = await fetch(`http://localhost:${port}/?token=secret123`);
    expect(uiWithToken.ok).toBe(true);
    const html = await uiWithToken.text();
    expect(html).toContain('Ithilien');
  });

  it('handles claude approval flow end-to-end', async () => {
    srv = createApprovalServer({ port, authToken: 'test', timeout: 10 });
    await srv.start();

    // Submit a Claude hook request with token (non-blocking via Promise.all)
    const hookRequest = fetch(`http://localhost:${port}/api/claude-approval?token=test`, {
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
    const pendingRes = await fetch(`http://localhost:${port}/api/requests?token=test`);
    const pending = await pendingRes.json();
    expect(pending).toHaveLength(1);
    expect(pending[0].tool).toBe('Bash');
    expect(pending[0].description).toBe('Run command: npm test');
    expect(pending[0].status).toBe('pending');

    // Approve the request (with token)
    const respondRes = await fetch(
      `http://localhost:${port}/api/respond/${pending[0].id}?token=test`,
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
    const timeoutPort = 13459;
    const timeoutSrv = createApprovalServer({ port: timeoutPort, authToken: 'test', timeout: 1 });
    await timeoutSrv.start();

    try {
      const hookRes = await fetch(`http://localhost:${timeoutPort}/api/claude-approval?token=test`, {
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
    srv = createApprovalServer({ port, authToken: 'test', timeout: 10 });
    await srv.start();

    // Submit request with token
    const hookRequest = fetch(`http://localhost:${port}/api/claude-approval?token=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
    });

    await new Promise((r) => setTimeout(r, 200));

    const pendingRes = await fetch(`http://localhost:${port}/api/requests?token=test`);
    const pending = await pendingRes.json();
    const id = pending[0].id;

    // First response succeeds
    const first = await fetch(`http://localhost:${port}/api/respond/${id}?token=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(first.ok).toBe(true);

    // Second response fails with 409
    const second = await fetch(`http://localhost:${port}/api/respond/${id}?token=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'denied' }),
    });
    expect(second.status).toBe(409);

    await hookRequest;
  });
});
