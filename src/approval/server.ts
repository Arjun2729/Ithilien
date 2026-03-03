import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { getApprovalHTML } from './ui.js';
import type { ApprovalRequest } from '../types.js';

export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

// ===== Body parser =====
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ===== JSON response helpers =====
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, message: string) {
  json(res, { error: message }, status);
}

// ===== Auth check =====
function isLocalRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress;
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function checkTokenAuth(req: IncomingMessage, url: URL, authToken: string): boolean {
  const token = url.searchParams.get('token') ?? req.headers.authorization?.replace('Bearer ', '');
  return token === authToken;
}

// ===== Describe a tool call for the phone UI =====
function describeToolCall(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return `Run command: ${toolInput.command ?? '(unknown)'}`;
    case 'Edit':
      return `Edit file: ${toolInput.file_path ?? '(unknown)'}`;
    case 'Write':
      return `Write file: ${toolInput.file_path ?? '(unknown)'}`;
    case 'Read':
      return `Read file: ${toolInput.file_path ?? '(unknown)'}`;
    case 'Glob':
      return `Search files: ${toolInput.pattern ?? '(unknown)'}`;
    case 'Grep':
      return `Search content: ${toolInput.pattern ?? '(unknown)'}`;
    case 'WebFetch':
      return `Fetch URL: ${toolInput.url ?? '(unknown)'}`;
    case 'WebSearch':
      return `Web search: ${toolInput.query ?? '(unknown)'}`;
    default:
      if (toolName.startsWith('mcp__')) {
        return `MCP tool: ${toolName}`;
      }
      return `Tool: ${toolName}`;
  }
}

// ===== Server factory =====

export interface ApprovalServerOptions {
  port: number;
  host?: string;
  authToken: string;
  timeout: number;
}

export function createApprovalServer(options: ApprovalServerOptions) {
  const { port, host, authToken, timeout } = options;

  // Per-instance state
  const requests = new Map<string, ApprovalRequest>();
  const waiters = new Map<string, (decision: 'approved' | 'denied') => void>();
  const sseClients = new Set<ServerResponse>();

  function broadcast(event: string, data: unknown) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(msg);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function handleGetRequests(res: ServerResponse) {
    const all = Array.from(requests.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    json(res, all);
  }

  async function handleClaudeApproval(req: IncomingMessage, res: ServerResponse) {
    const body = JSON.parse(await readBody(req));
    const id = nanoid(12);

    const toolName: string = body.tool_name ?? 'Unknown';
    const toolInput: Record<string, unknown> = body.tool_input ?? {};

    const approvalReq: ApprovalRequest = {
      id,
      timestamp: new Date().toISOString(),
      tool: toolName,
      description: describeToolCall(toolName, toolInput),
      input: toolInput,
      status: 'pending',
    };

    requests.set(id, approvalReq);
    broadcast('new_request', approvalReq);

    const decision = await new Promise<'approved' | 'denied'>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        approvalReq.status = 'timeout';
        approvalReq.respondedAt = new Date().toISOString();
        broadcast('request_resolved', { id, status: 'timeout', respondedAt: approvalReq.respondedAt });
        resolve('denied');
      }, timeout * 1000);

      waiters.set(id, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });

    json(res, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision === 'approved' ? 'allow' : 'deny',
        permissionDecisionReason:
          decision === 'approved'
            ? 'Approved remotely via Ithilien'
            : approvalReq.status === 'timeout'
              ? 'Approval timed out — auto-denied by Ithilien'
              : 'Denied remotely via Ithilien',
      },
    });
  }

  async function handlePostRequest(req: IncomingMessage, res: ServerResponse) {
    const body = JSON.parse(await readBody(req));
    const id = nanoid(12);
    const approvalReq: ApprovalRequest = {
      id,
      timestamp: new Date().toISOString(),
      tool: body.tool ?? 'Unknown',
      description: body.description ?? '',
      input: body.input ?? {},
      status: 'pending',
    };

    requests.set(id, approvalReq);
    broadcast('new_request', approvalReq);

    const decision = await new Promise<'approved' | 'denied'>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        approvalReq.status = 'timeout';
        approvalReq.respondedAt = new Date().toISOString();
        broadcast('request_resolved', { id, status: 'timeout', respondedAt: approvalReq.respondedAt });
        resolve('denied');
      }, timeout * 1000);

      waiters.set(id, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });

    json(res, { id, decision });
  }

  function handlePostRespond(res: ServerResponse, id: string, body: { decision: 'approved' | 'denied' }) {
    const req = requests.get(id);
    if (!req) {
      sendError(res, 404, 'Request not found');
      return;
    }
    if (req.status !== 'pending') {
      sendError(res, 409, 'Request already resolved');
      return;
    }

    req.status = body.decision;
    req.respondedAt = new Date().toISOString();

    const waiter = waiters.get(id);
    if (waiter) {
      waiter(body.decision);
      waiters.delete(id);
    }

    broadcast('request_resolved', { id, status: req.status, respondedAt: req.respondedAt });
    json(res, { ok: true });
  }

  function handleSSE(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Prevent proxy buffering (nginx, cloudflared)
    });
    // Flush headers immediately so proxies don't buffer the initial response
    res.flushHeaders();

    const all = Array.from(requests.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    res.write(`event: sync\ndata: ${JSON.stringify(all)}\n\n`);

    sseClients.add(res);

    // Send real SSE events (not comments) as keepalives. HTTP/2 proxies like
    // cloudflared treat SSE comments (: ping) as empty frames and may cancel
    // the stream. A named event with data counts as real traffic.
    const ping = setInterval(() => {
      try {
        res.write(`event: ping\ndata: ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, 5000);

    const cleanup = () => {
      clearInterval(ping);
      sseClients.delete(res);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    try {
      // /health — no auth
      if (path === '/health' && req.method === 'GET') {
        json(res, { ok: true, pending: requests.size });
        return;
      }

      // All endpoints below /health require token auth.
      // The claude-approval endpoint needs the token too because a local
      // tunnel proxy (cloudflared, localtunnel) makes remote requests
      // appear to come from localhost, bypassing IP-based checks.
      if (!checkTokenAuth(req, url, authToken)) {
        sendError(res, 401, 'Unauthorized');
        return;
      }

      // /api/claude-approval — Claude Code HTTP hook endpoint
      if (path === '/api/claude-approval' && req.method === 'POST') {
        await handleClaudeApproval(req, res);
        return;
      }

      if (path === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getApprovalHTML(authToken));
      } else if (path === '/api/requests' && req.method === 'GET') {
        handleGetRequests(res);
      } else if (path === '/api/request' && req.method === 'POST') {
        await handlePostRequest(req, res);
      } else if (path.startsWith('/api/respond/') && req.method === 'POST') {
        const id = path.split('/').pop()!;
        const body = JSON.parse(await readBody(req));
        handlePostRespond(res, id, body);
      } else if (path === '/api/events' && req.method === 'GET') {
        handleSSE(req, res);
      } else {
        sendError(res, 404, 'Not found');
      }
    } catch (err) {
      console.error('Server error:', err);
      sendError(res, 500, 'Internal server error');
    }
  });

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        const onListening = () => {
          server.removeListener('error', reject);
          resolve();
        };
        if (host) {
          server.listen(port, host, onListening);
        } else {
          // If host is omitted, Node will typically bind to a dual-stack address (e.g. ::)
          // which avoids localhost IPv4/IPv6 resolution flakiness in some environments.
          server.listen(port, onListening);
        }
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        for (const client of sseClients) {
          try { client.end(); } catch { /* ignore */ }
        }
        sseClients.clear();
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    server,
    get pendingCount() {
      return Array.from(requests.values()).filter(r => r.status === 'pending').length;
    },
  };
}
