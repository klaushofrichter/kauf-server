import { BulbWithState } from '../bulbs/service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBulbList(bulbs: BulbWithState[]): string {
  if (bulbs.length === 0) {
    return '<p id="bulbs-empty">No bulbs discovered yet.</p>';
  }

  const rows = bulbs
    .map((bulb) => {
      const statusClass = bulb.online ? (bulb.on ? 'on' : 'off') : 'offline';
      const statusText = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      return `
    <li class="bulb ${statusClass}">
      <span class="bulb-name">${escapeHtml(bulb.name)}</span>
      <span class="bulb-status">${statusText}</span>
      <form method="POST" action="/ui/bulb/${encodeURIComponent(bulb.id)}/toggle">
        <button type="submit" ${bulb.online ? '' : 'disabled'}>${bulb.on ? 'Turn off' : 'Turn on'}</button>
      </form>
    </li>`;
    })
    .join('');

  return `<ul id="bulbs-list">${rows}</ul>`;
}

export function renderPage(email: string, bulbs: BulbWithState[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kauf Bulbs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    a.logout { color: #666; text-decoration: none; font-size: 0.9rem; }
    a.logout:hover { text-decoration: underline; }
    #bulbs-empty { color: #888; font-style: italic; }
    #bulbs-list { list-style: none; padding: 0; }
    .bulb { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid #eee; }
    .bulb-name { flex: 1; }
    .bulb-status { font-size: 0.85rem; padding: 0.2rem 0.6rem; border-radius: 1rem; }
    .bulb.on .bulb-status { background: #d4f7d4; color: #1a6b1a; }
    .bulb.off .bulb-status { background: #eee; color: #555; }
    .bulb.offline .bulb-status { background: #f7d4d4; color: #8b1a1a; }
    .bulb form { margin: 0; }
  </style>
</head>
<body>
  <header>
    <h1>Kauf Bulbs</h1>
    <div>
      <span>${escapeHtml(email)}</span> &middot;
      <a class="logout" href="/auth/logout">Sign out</a>
    </div>
  </header>
  ${renderBulbList(bulbs)}
</body>
</html>
`;
}
