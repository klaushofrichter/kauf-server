import { BulbWithState } from '../bulbs/service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BULB_ICON_PATH =
  'M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm-2 17h4v1a2 2 0 0 1-4 0v-1z';

function renderBulbList(bulbs: BulbWithState[]): string {
  if (bulbs.length === 0) {
    return '<p id="bulbs-empty">No bulbs discovered yet.</p>';
  }

  const cards = bulbs
    .map((bulb) => {
      const statusClass = bulb.online ? (bulb.on ? 'on' : 'off') : 'offline';
      const statusText = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      const iconColor =
        bulb.online && bulb.on && bulb.r !== null ? `rgb(${bulb.r},${bulb.g},${bulb.b})` : '#999';
      return `
    <div class="bulb-card ${statusClass}" data-id="${escapeHtml(bulb.id)}" tabindex="0" role="button">
      <svg class="bulb-icon" viewBox="0 0 24 24" style="--bulb-color: ${iconColor}"><path d="${BULB_ICON_PATH}"/></svg>
      <span class="bulb-name">${escapeHtml(bulb.name)}</span>
      <span class="bulb-status">${statusText}</span>
      <form class="bulb-toggle-form" method="POST" action="/ui/bulb/${encodeURIComponent(bulb.id)}/toggle">
        <button type="submit" ${bulb.online ? '' : 'disabled'}>${bulb.on ? 'Turn off' : 'Turn on'}</button>
      </form>
    </div>`;
    })
    .join('');

  return `<div id="bulbs-grid">${cards}</div>`;
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
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 3rem auto; padding: 0 1rem; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    a.logout { color: #666; text-decoration: none; font-size: 0.9rem; }
    a.logout:hover { text-decoration: underline; }
    #bulbs-empty { color: #888; font-style: italic; }
    .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .toolbar form { margin: 0; }
    #bulbs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .bulb-card { border: 1px solid #eee; border-radius: 0.5rem; padding: 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; cursor: pointer; }
    .bulb-icon { width: 48px; height: 48px; fill: var(--bulb-color, #999); transition: fill 0.2s; }
    .bulb-card.offline .bulb-icon { fill: #ccc; }
    .bulb-name { font-weight: 600; text-align: center; }
    .bulb-status { font-size: 0.85rem; padding: 0.2rem 0.6rem; border-radius: 1rem; }
    .bulb-card.on .bulb-status { background: #d4f7d4; color: #1a6b1a; }
    .bulb-card.off .bulb-status { background: #eee; color: #555; }
    .bulb-card.offline .bulb-status { background: #f7d4d4; color: #8b1a1a; }
    .bulb-toggle-form { margin: 0; }
    dialog#bulb-modal { border: none; border-radius: 0.5rem; padding: 1.5rem; max-width: 320px; width: 90%; }
    dialog#bulb-modal::backdrop { background: rgba(0, 0, 0, 0.4); }
    .modal-close { float: right; background: none; border: none; font-size: 1.5rem; cursor: pointer; line-height: 1; }
    #modal-error { color: #8b1a1a; font-size: 0.85rem; margin: 0; min-height: 1em; }
    #modal-error:empty { display: none; }
    #bulb-modal dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; margin: 1rem 0; }
    #bulb-modal dt { color: #666; }
    #bulb-modal label { display: block; margin: 0.75rem 0; }
    #bulb-modal input[type="range"], #bulb-modal input[type="color"] { width: 100%; }
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
  <div class="toolbar">
    <form method="POST" action="/ui/discover"><button type="submit">Refresh</button></form>
    <form method="POST" action="/ui/bulbs/on"><button type="submit">All On</button></form>
    <form method="POST" action="/ui/bulbs/off"><button type="submit">All Off</button></form>
  </div>
  ${renderBulbList(bulbs)}

  <dialog id="bulb-modal">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <h2 id="modal-name"></h2>
    <p id="modal-error"></p>
    <dl>
      <dt>MAC</dt><dd id="modal-mac"></dd>
      <dt>Firmware</dt><dd id="modal-firmware"></dd>
      <dt>ESPHome</dt><dd id="modal-esphome"></dd>
      <dt>Status</dt><dd id="modal-status"></dd>
    </dl>
    <button id="modal-toggle" type="button">Toggle</button>
    <label>Brightness
      <input id="modal-brightness" type="range" min="0" max="100">
    </label>
    <label>Color
      <input id="modal-color" type="color">
    </label>
  </dialog>

  <script>
  (function () {
    var grid = document.getElementById('bulbs-grid');
    var modal = document.getElementById('bulb-modal');
    var currentId = null;

    function rgbToHex(r, g, b) {
      function hex(v) { return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'); }
      return '#' + hex(r) + hex(g) + hex(b);
    }

    function hexToRgb(hex) {
      var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 255, b: 255 };
    }

    function fillModal(bulb) {
      document.getElementById('modal-name').textContent = bulb.name;
      document.getElementById('modal-mac').textContent = bulb.mac;
      document.getElementById('modal-firmware').textContent = bulb.firmwareVersion || 'unknown';
      document.getElementById('modal-esphome').textContent = bulb.esphomeVersion || 'unknown';
      document.getElementById('modal-status').textContent = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      var toggleBtn = document.getElementById('modal-toggle');
      toggleBtn.textContent = bulb.on ? 'Turn off' : 'Turn on';
      toggleBtn.disabled = !bulb.online;
      var brightnessInput = document.getElementById('modal-brightness');
      brightnessInput.value = bulb.brightness != null ? bulb.brightness : 0;
      brightnessInput.disabled = !bulb.online;
      var colorInput = document.getElementById('modal-color');
      colorInput.value = bulb.r != null ? rgbToHex(bulb.r, bulb.g, bulb.b) : '#ffffff';
      colorInput.disabled = !bulb.online;
    }

    function updateCard(bulb) {
      var card = grid.querySelector('[data-id="' + bulb.id + '"]');
      if (!card) return;
      card.className = 'bulb-card ' + (bulb.online ? (bulb.on ? 'on' : 'off') : 'offline');
      var icon = card.querySelector('.bulb-icon');
      icon.style.setProperty('--bulb-color', bulb.online && bulb.on && bulb.r != null ? 'rgb(' + bulb.r + ',' + bulb.g + ',' + bulb.b + ')' : '#999');
      card.querySelector('.bulb-status').textContent = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      var btn = card.querySelector('.bulb-toggle-form button');
      btn.textContent = bulb.on ? 'Turn off' : 'Turn on';
      btn.disabled = !bulb.online;
    }

    function showModalError(message) {
      var el = document.getElementById('modal-error');
      if (el) el.textContent = message;
    }

    function openModal(id) {
      currentId = id;
      showModalError('');
      fetch('/ui/bulb/' + encodeURIComponent(id))
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to load bulb (' + res.status + ')');
          return res.json();
        })
        .then(function (bulb) {
          fillModal(bulb);
          modal.showModal();
        })
        .catch(function () {
          showModalError('Could not load bulb details. Please try again.');
        });
    }

    function submitChange(options) {
      if (!currentId) return;
      showModalError('');
      fetch('/ui/bulb/' + encodeURIComponent(currentId) + '/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to update bulb (' + res.status + ')');
          return res.json();
        })
        .then(function (bulb) {
          if (bulb && bulb.id) {
            fillModal(bulb);
            updateCard(bulb);
          }
        })
        .catch(function () {
          showModalError('Could not update bulb. Please try again.');
        });
    }

    if (grid) {
      grid.addEventListener('click', function (event) {
        var card = event.target.closest('.bulb-card');
        if (!card) return;
        if (event.target.closest('.bulb-toggle-form')) return;
        openModal(card.getAttribute('data-id'));
      });

      grid.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
        var card = event.target.closest('.bulb-card');
        if (!card) return;
        if (event.target.closest('.bulb-toggle-form')) return;
        event.preventDefault();
        openModal(card.getAttribute('data-id'));
      });
    }

    modal.addEventListener('click', function (event) {
      if (event.target === modal) modal.close();
    });

    document.getElementById('modal-toggle').addEventListener('click', function () {
      var isOn = document.getElementById('modal-toggle').textContent === 'Turn off';
      submitChange({ on: !isOn });
    });

    document.getElementById('modal-brightness').addEventListener('change', function (event) {
      submitChange({ brightness: Number(event.target.value) });
    });

    document.getElementById('modal-color').addEventListener('change', function (event) {
      var rgb = hexToRgb(event.target.value);
      submitChange({ r: rgb.r, g: rgb.g, b: rgb.b });
    });

    document.querySelector('.modal-close').addEventListener('click', function () {
      modal.close();
    });
  })();
  </script>
</body>
</html>
`;
}
