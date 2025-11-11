/**
 * Client-side live reload script
 *
 * This script is injected into HTML in development mode
 */

export function getReloadScript(): string {
  return `
<script>
(function() {
  // Only run in development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/__reload';
    let ws;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = function() {
        console.log('[Zebric] 🔌 Connected to live reload server');
        reconnectAttempts = 0;
      };

      ws.onmessage = function(event) {
        const data = JSON.parse(event.data);

        switch(data.type) {
          case 'connected':
            console.log('[Zebric] 📡', data.message);
            break;

          case 'reload':
            console.log('[Zebric] 🔄 Blueprint changed, reloading page...');
            if (data.changes) {
              console.log('[Zebric] Changes:', data.changes.join(', '));
            }

            // Use View Transitions API if available
            if (document.startViewTransition) {
              document.startViewTransition(() => {
                window.location.reload();
              });
            } else {
              window.location.reload();
            }
            break;

          case 'error':
            console.error('[Zebric] ❌ Blueprint error:', data.message);
            // Show error overlay
            showErrorOverlay(data.message);
            break;
        }
      };

      ws.onclose = function() {
        console.log('[Zebric] 🔌 Disconnected from live reload server');

        // Try to reconnect
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(1000 * reconnectAttempts, 5000);
          console.log(\`[Zebric] 🔄 Reconnecting in \${delay}ms...\`);
          setTimeout(connect, delay);
        }
      };

      ws.onerror = function(error) {
        console.error('[Zebric] ❌ WebSocket error:', error);
      };
    }

    function showErrorOverlay(message) {
      // Remove existing overlay
      const existing = document.getElementById('zbl-error-overlay');
      if (existing) {
        existing.remove();
      }

      // Create error overlay
      const overlay = document.createElement('div');
      overlay.id = 'zbl-error-overlay';
      overlay.innerHTML = \`
        <div style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.9);
          color: white;
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        ">
          <div style="
            max-width: 800px;
            background: #1a1a1a;
            border: 2px solid #ef4444;
            border-radius: 8px;
            padding: 24px;
          ">
            <h2 style="
              color: #ef4444;
              margin: 0 0 16px 0;
              font-size: 24px;
            ">Blueprint Error</h2>
            <pre style="
              background: #000;
              padding: 16px;
              border-radius: 4px;
              overflow-x: auto;
              font-size: 14px;
              line-height: 1.5;
              margin: 0;
            ">\${message}</pre>
            <button
              onclick="document.getElementById('zbl-error-overlay').remove()"
              style="
                margin-top: 16px;
                background: #ef4444;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
              "
            >Close</button>
          </div>
        </div>
      \`;
      document.body.appendChild(overlay);
    }

    // Start connection
    connect();
  }
})();
</script>
`;
}
