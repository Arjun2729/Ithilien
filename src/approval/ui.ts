/**
 * Mobile-optimized web UI for remote approval.
 * Pure HTML/CSS/JS — no build step needed.
 */
export function getApprovalHTML(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Ithilien — Remote Approvals</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #09090b;
      color: #e4e4e7;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 16px;
      padding-top: env(safe-area-inset-top, 16px);
      padding-bottom: env(safe-area-inset-bottom, 16px);
      -webkit-font-smoothing: antialiased;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      margin-bottom: 16px;
      border-bottom: 1px solid #27272a;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 700;
      color: #fafafa;
      letter-spacing: -0.02em;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #a1a1aa;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      animation: pulse 2s infinite;
    }
    .status-dot.disconnected {
      background: #ef4444;
      animation: none;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .empty {
      text-align: center;
      padding: 60px 20px;
      color: #71717a;
    }
    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    .empty p {
      font-size: 15px;
      line-height: 1.5;
    }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      animation: slideIn 0.3s ease-out;
    }
    .card.pending {
      border-color: #f59e0b;
      box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.1);
    }
    .card.approved {
      border-color: #22c55e;
      opacity: 0.6;
    }
    .card.denied {
      border-color: #ef4444;
      opacity: 0.6;
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .tool-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #27272a;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 13px;
      font-weight: 600;
      color: #fafafa;
    }
    .tool-icon {
      font-size: 14px;
    }
    .time-ago {
      font-size: 12px;
      color: #71717a;
    }
    .description {
      font-size: 14px;
      line-height: 1.5;
      color: #d4d4d8;
      margin-bottom: 12px;
    }
    .details {
      background: #0a0a0a;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #a1a1aa;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .btn {
      border: none;
      border-radius: 10px;
      padding: 14px 20px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .btn:active {
      transform: scale(0.97);
    }
    .btn-approve {
      background: #22c55e;
      color: #052e16;
    }
    .btn-approve:active {
      background: #16a34a;
    }
    .btn-deny {
      background: #ef4444;
      color: #450a0a;
    }
    .btn-deny:active {
      background: #dc2626;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .resolved-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
    }
    .resolved-badge.approved {
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
    }
    .resolved-badge.denied {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .counter {
      background: #f59e0b;
      color: #0a0a0a;
      border-radius: 10px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 700;
      margin-left: 8px;
    }
    .history-label {
      font-size: 13px;
      color: #52525b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      padding: 16px 0 8px;
    }
    .notification-sound { display: none; }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;align-items:center">
      <h1>Ithilien</h1>
      <span id="pending-count"></span>
    </div>
    <div class="status">
      <div class="status-dot" id="status-dot"></div>
      <span id="status-text">Connected</span>
    </div>
  </div>

  <div id="pending-section"></div>
  <div id="history-section"></div>

  <script>
    const TOKEN = '${token}';
    const API = window.location.origin;
    let requests = [];
    let connected = false;
    let eventSource = null;

    // === Tool icons ===
    const TOOL_ICONS = {
      Bash: '\\u{1F4BB}',
      Edit: '\\u{270F}\\u{FE0F}',
      Write: '\\u{1F4DD}',
      Read: '\\u{1F4C4}',
      Glob: '\\u{1F50D}',
      Grep: '\\u{1F50E}',
      default: '\\u{1F527}'
    };

    function getIcon(tool) {
      return TOOL_ICONS[tool] || TOOL_ICONS.default;
    }

    function timeAgo(ts) {
      const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
      if (s < 5) return 'just now';
      if (s < 60) return s + 's ago';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      return Math.floor(s / 3600) + 'h ago';
    }

    function truncate(str, len) {
      if (typeof str !== 'string') str = JSON.stringify(str, null, 2);
      return str.length > len ? str.slice(0, len) + '...' : str;
    }

    function formatDetails(input) {
      if (!input || Object.keys(input).length === 0) return '';
      const parts = [];
      for (const [k, v] of Object.entries(input)) {
        const val = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
        parts.push(k + ': ' + val);
      }
      return parts.join('\\n');
    }

    function renderRequests() {
      const pending = requests.filter(r => r.status === 'pending');
      const resolved = requests.filter(r => r.status !== 'pending');

      // Update counter
      const countEl = document.getElementById('pending-count');
      countEl.innerHTML = pending.length > 0
        ? '<span class="counter">' + pending.length + '</span>' : '';

      // Pending section
      const pendingEl = document.getElementById('pending-section');
      if (pending.length === 0) {
        pendingEl.innerHTML = '<div class="empty"><div class="empty-icon">\\u{1F6E1}\\u{FE0F}</div><p>No pending approvals<br><span style="color:#52525b">Requests will appear here in real-time</span></p></div>';
      } else {
        pendingEl.innerHTML = pending.map(r => \`
          <div class="card pending" id="card-\${r.id}">
            <div class="card-header">
              <div class="tool-badge">
                <span class="tool-icon">\${getIcon(r.tool)}</span>
                \${escapeHtml(r.tool)}
              </div>
              <span class="time-ago">\${timeAgo(r.timestamp)}</span>
            </div>
            <div class="description">\${escapeHtml(r.description)}</div>
            \${r.input && Object.keys(r.input).length > 0 ? '<div class="details">' + escapeHtml(formatDetails(r.input)) + '</div>' : ''}
            <div class="actions">
              <button class="btn btn-approve" onclick="respond('\${r.id}', 'approved')">Approve</button>
              <button class="btn btn-deny" onclick="respond('\${r.id}', 'denied')">Deny</button>
            </div>
          </div>
        \`).join('');
      }

      // History section
      const historyEl = document.getElementById('history-section');
      if (resolved.length > 0) {
        historyEl.innerHTML = '<div class="history-label">History</div>' +
          resolved.slice(0, 20).map(r => \`
            <div class="card \${r.status}">
              <div class="card-header">
                <div class="tool-badge">
                  <span class="tool-icon">\${getIcon(r.tool)}</span>
                  \${escapeHtml(r.tool)}
                </div>
                <span class="resolved-badge \${r.status}">\${r.status === 'approved' ? '\\u2713 Approved' : '\\u2717 Denied'}</span>
              </div>
              <div class="description">\${escapeHtml(r.description)}</div>
            </div>
          \`).join('');
      } else {
        historyEl.innerHTML = '';
      }
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    async function respond(id, decision) {
      const btns = document.querySelectorAll('#card-' + id + ' .btn');
      btns.forEach(b => b.disabled = true);

      try {
        const res = await fetch(API + '/api/respond/' + id + '?token=' + TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision })
        });
        if (!res.ok) throw new Error('Failed');
        const req = requests.find(r => r.id === id);
        if (req) {
          req.status = decision;
          req.respondedAt = new Date().toISOString();
        }
        renderRequests();
      } catch (e) {
        btns.forEach(b => b.disabled = false);
        alert('Failed to send response. Check connection.');
      }
    }

    // Notification sound using Web Audio
    function playNotification() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.3;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {}
    }

    // Vibrate on mobile
    function vibrate() {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }

    // SSE connection for real-time updates
    function connectSSE() {
      if (eventSource) eventSource.close();
      eventSource = new EventSource(API + '/api/events?token=' + TOKEN);

      eventSource.onopen = () => {
        connected = true;
        document.getElementById('status-dot').classList.remove('disconnected');
        document.getElementById('status-text').textContent = 'Connected';
      };

      eventSource.onerror = () => {
        connected = false;
        document.getElementById('status-dot').classList.add('disconnected');
        document.getElementById('status-text').textContent = 'Reconnecting...';
      };

      eventSource.addEventListener('new_request', (e) => {
        const req = JSON.parse(e.data);
        const existing = requests.findIndex(r => r.id === req.id);
        if (existing === -1) {
          requests.unshift(req);
          playNotification();
          vibrate();
        }
        renderRequests();
      });

      eventSource.addEventListener('request_resolved', (e) => {
        const data = JSON.parse(e.data);
        const req = requests.find(r => r.id === data.id);
        if (req) {
          req.status = data.status;
          req.respondedAt = data.respondedAt;
        }
        renderRequests();
      });

      eventSource.addEventListener('sync', (e) => {
        requests = JSON.parse(e.data);
        renderRequests();
      });
    }

    // Initial load
    async function loadRequests() {
      try {
        const res = await fetch(API + '/api/requests?token=' + TOKEN);
        if (res.ok) {
          requests = await res.json();
          renderRequests();
        }
      } catch (e) {}
    }

    // Update time-ago labels periodically
    setInterval(() => {
      document.querySelectorAll('.time-ago').forEach((el, i) => {
        const pending = requests.filter(r => r.status === 'pending');
        if (pending[i]) el.textContent = timeAgo(pending[i].timestamp);
      });
    }, 5000);

    loadRequests();
    connectSSE();
    renderRequests();
  </script>
</body>
</html>`;
}
