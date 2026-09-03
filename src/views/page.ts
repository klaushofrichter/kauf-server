import { BulbWithState } from '../bulbs/service';
import { appVersion } from '../version';

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
    .app-version { color: #999; font-size: 0.8rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    #bulbs-empty { color: #888; font-style: italic; }
    .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .toolbar form { margin: 0; }
    .toolbar button[disabled], .bulb-toggle-form button[disabled] { opacity: 0.5; cursor: default; }
    #busy-panel { margin: -0.75rem 0 1.25rem; padding: 0.6rem 0.9rem; background: #eef4ff; border: 1px solid #cddcf5; border-radius: 0.35rem; color: #23406e; font-size: 0.9rem; }
    #busy-panel[hidden] { display: none; }
    #bulbs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .bulb-card { background: #fafafa; border: 1px solid #eee; border-radius: 0.5rem; padding: 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; cursor: pointer; }
    .bulb-icon { width: 48px; height: 48px; fill: var(--bulb-color, #999); transition: fill 0.2s; }
    .bulb-card.offline .bulb-icon { fill: #ccc; }
    .bulb-name { font-weight: 600; text-align: center; }
    .bulb-status { font-size: 0.85rem; padding: 0.2rem 0.6rem; border-radius: 1rem; }
    .bulb-card.on .bulb-status { background: #d4f7d4; color: #1a6b1a; }
    .bulb-card.off .bulb-status { background: #eee; color: #555; }
    .bulb-card.offline .bulb-status { background: #f7d4d4; color: #8b1a1a; }
    .bulb-toggle-form { margin: 0; }
    dialog#bulb-modal { border: none; border-radius: 0.75rem; padding: 2rem; max-width: 460px; width: 92%; }
    dialog#bulb-modal::backdrop { background: rgba(0, 0, 0, 0.4); }
    .modal-close { float: right; background: none; border: none; font-size: 1.75rem; cursor: pointer; line-height: 1; }
    #modal-error { color: #8b1a1a; font-size: 0.9rem; margin: 0; min-height: 1.2em; }
    #modal-error:empty { display: none; }
    #bulb-modal dl { display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 0.75rem; margin: 1rem 0; }
    #bulb-modal dt { color: #666; }
    #bulb-modal label { display: block; margin: 1rem 0; font-weight: 600; }
    #bulb-modal input[type="range"] { width: 100%; margin-top: 0.35rem; }
    .modal-name-row { display: flex; gap: 0.5rem; align-items: center; margin: 1rem 0; }
    .modal-name-row input[type="text"] { flex: 1; padding: 0.5rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 0.35rem; }
    .modal-color-row { display: flex; gap: 1rem; align-items: center; margin-top: 0.35rem; }
    #modal-color { width: 4rem; height: 4rem; padding: 0; border: 1px solid #ccc; border-radius: 0.35rem; cursor: pointer; }
    .modal-rgb-inputs { display: flex; gap: 0.5rem; }
    .modal-rgb-inputs label { margin: 0; font-weight: normal; font-size: 0.8rem; color: #666; display: flex; flex-direction: column; gap: 0.15rem; }
    .modal-rgb-inputs input[type="number"] { width: 4rem; padding: 0.35rem; font-size: 0.95rem; border: 1px solid #ccc; border-radius: 0.35rem; }
    #modal-set { margin-top: 2rem; padding: 0.6rem 1.2rem; font-size: 1rem; }
  </style>
</head>
<body>
  <header>
    <h1>Kauf Bulbs</h1>
    <div>
      <span id="app-version" class="app-version">${escapeHtml(appVersion())}</span> &middot;
      <span>${escapeHtml(email)}</span> &middot;
      <a class="logout" href="/auth/logout">Sign out</a>
    </div>
  </header>
  <div class="toolbar">
    <form method="POST" action="/ui/discover" data-busy="Scanning the network for bulbs&hellip;"><button type="submit">Refresh</button></form>
    <form method="POST" action="/ui/bulbs/on" data-busy="Turning all bulbs on&hellip;"><button type="submit">All On</button></form>
    <form method="POST" action="/ui/bulbs/off" data-busy="Turning all bulbs off&hellip;"><button type="submit">All Off</button></form>
  </div>
  <p id="busy-panel" role="status" aria-live="polite" hidden></p>
  ${renderBulbList(bulbs)}

  <dialog id="bulb-modal">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <h2 id="modal-name"></h2>
    <p id="modal-error"></p>
    <div class="modal-name-row">
      <input id="modal-name-input" type="text" aria-label="Nickname">
      <button id="modal-name-save" type="button">Save name</button>
    </div>
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
      <div class="modal-color-row">
        <input id="modal-color" type="color">
        <div class="modal-rgb-inputs">
          <label>R<input id="modal-r" type="number" min="0" max="255"></label>
          <label>G<input id="modal-g" type="number" min="0" max="255"></label>
          <label>B<input id="modal-b" type="number" min="0" max="255"></label>
          <label>Brightness<input id="modal-brightness-value" type="number" min="0" max="100"></label>
        </div>
      </div>
    </label>
    <button id="modal-set" type="button">Set</button>
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
      document.getElementById('modal-name-input').value = bulb.name;
      document.getElementById('modal-mac').textContent = bulb.mac;
      document.getElementById('modal-firmware').textContent = bulb.firmwareVersion || 'unknown';
      document.getElementById('modal-esphome').textContent = bulb.esphomeVersion || 'unknown';
      document.getElementById('modal-status').textContent = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      var toggleBtn = document.getElementById('modal-toggle');
      toggleBtn.textContent = bulb.on ? 'Turn off' : 'Turn on';
      toggleBtn.disabled = !bulb.online;
      var brightness = bulb.brightness != null ? bulb.brightness : 0;
      var brightnessInput = document.getElementById('modal-brightness');
      brightnessInput.value = brightness;
      brightnessInput.disabled = !bulb.online;
      var brightnessValueInput = document.getElementById('modal-brightness-value');
      brightnessValueInput.value = brightness;
      brightnessValueInput.disabled = !bulb.online;
      var r = bulb.r != null ? bulb.r : 255;
      var g = bulb.g != null ? bulb.g : 255;
      var b = bulb.b != null ? bulb.b : 255;
      var colorInput = document.getElementById('modal-color');
      colorInput.value = rgbToHex(r, g, b);
      colorInput.disabled = !bulb.online;
      var rInput = document.getElementById('modal-r');
      var gInput = document.getElementById('modal-g');
      var bInput = document.getElementById('modal-b');
      rInput.value = r;
      gInput.value = g;
      bInput.value = b;
      rInput.disabled = !bulb.online;
      gInput.disabled = !bulb.online;
      bInput.disabled = !bulb.online;
      document.getElementById('modal-set').disabled = !bulb.online;
    }

    function currentRgb() {
      var r = Number(document.getElementById('modal-r').value);
      var g = Number(document.getElementById('modal-g').value);
      var b = Number(document.getElementById('modal-b').value);
      return { r: r, g: g, b: b };
    }

    function updateCard(bulb) {
      var card = grid.querySelector('[data-id="' + bulb.id + '"]');
      if (!card) return;
      card.className = 'bulb-card ' + (bulb.online ? (bulb.on ? 'on' : 'off') : 'offline');
      var icon = card.querySelector('.bulb-icon');
      icon.style.setProperty('--bulb-color', bulb.online && bulb.on && bulb.r != null ? 'rgb(' + bulb.r + ',' + bulb.g + ',' + bulb.b + ')' : '#999');
      card.querySelector('.bulb-name').textContent = bulb.name;
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
          if (res.status === 429) throw new Error('rate-limited');
          if (!res.ok) throw new Error('Failed to update bulb (' + res.status + ')');
          return res.json();
        })
        .then(function (bulb) {
          if (bulb && bulb.id) {
            fillModal(bulb);
            updateCard(bulb);
          }
        })
        .catch(function (err) {
          if (err && err.message === 'rate-limited') {
            showModalError('Too many requests - please wait a moment and try again.');
          } else {
            showModalError('Could not update bulb. Please try again.');
          }
        });
    }

    function submitName(name) {
      if (!currentId) return;
      showModalError('');
      fetch('/ui/bulb/' + encodeURIComponent(currentId) + '/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      })
        .then(function (res) {
          if (res.status === 429) throw new Error('rate-limited');
          if (!res.ok) throw new Error('Failed to update name (' + res.status + ')');
          return res.json();
        })
        .then(function (bulb) {
          if (bulb && bulb.id) {
            fillModal(bulb);
            updateCard(bulb);
          }
        })
        .catch(function (err) {
          if (err && err.message === 'rate-limited') {
            showModalError('Too many requests - please wait a moment and try again.');
          } else {
            showModalError('Could not save nickname. Please try again.');
          }
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
      // Checking event.target === modal (the usual backdrop-click pattern)
      // misfires here: closing the native color-picker popup dispatches a
      // click whose target is the dialog itself, not just a real backdrop
      // click. Compare against the dialog's actual box instead.
      var rect = modal.getBoundingClientRect();
      var inDialog =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inDialog) modal.close();
    });

    document.getElementById('modal-toggle').addEventListener('click', function () {
      var isOn = document.getElementById('modal-toggle').textContent === 'Turn off';
      submitChange({ on: !isOn });
    });

    document.getElementById('modal-color').addEventListener('input', function () {
      var rgb = hexToRgb(this.value);
      document.getElementById('modal-r').value = rgb.r;
      document.getElementById('modal-g').value = rgb.g;
      document.getElementById('modal-b').value = rgb.b;
    });

    ['modal-r', 'modal-g', 'modal-b'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        var rgb = currentRgb();
        document.getElementById('modal-color').value = rgbToHex(rgb.r, rgb.g, rgb.b);
      });
    });

    document.getElementById('modal-brightness').addEventListener('input', function () {
      document.getElementById('modal-brightness-value').value = this.value;
    });

    document.getElementById('modal-brightness-value').addEventListener('input', function () {
      document.getElementById('modal-brightness').value = this.value;
    });

    document.getElementById('modal-set').addEventListener('click', function () {
      var brightness = Number(document.getElementById('modal-brightness-value').value);
      var rgb = currentRgb();
      submitChange({ brightness: brightness, r: rgb.r, g: rgb.g, b: rgb.b });
    });

    document.getElementById('modal-name-save').addEventListener('click', function () {
      var name = document.getElementById('modal-name-input').value.trim();
      if (!name) {
        showModalError('Nickname cannot be empty.');
        return;
      }
      submitName(name);
    });

    document.querySelector('.modal-close').addEventListener('click', function () {
      modal.close();
    });

    // The toolbar actions are blocking server-side operations - a discovery
    // sweep of the whole subnet takes several seconds, and the bulk on/off
    // calls every known bulb. The page does not navigate until they finish,
    // so without this the UI sits looking identical and the click appears to
    // have done nothing. That is what made Refresh look like it was not
    // reading bulb status: it does, but only once the sweep returns.
    //
    // Bound on submit rather than click, so it covers keyboard submission
    // too, and so a browser without JS still posts the form normally - these
    // are plain form POSTs and must keep working unaided.
    Array.prototype.forEach.call(document.querySelectorAll('.toolbar form'), function (form) {
      form.addEventListener('submit', function () {
        var panel = document.getElementById('busy-panel');
        if (panel) {
          panel.textContent = form.getAttribute('data-busy') || 'Working\u2026';
          panel.hidden = false;
        }
        // Disable every button on the page, not just this form's: while a
        // sweep is in flight the others would queue up behind it, and a
        // second discovery scan is exactly what you do not want to start.
        // Deferred a tick so the button's own value still submits.
        setTimeout(function () {
          Array.prototype.forEach.call(
            document.querySelectorAll('.toolbar button, .bulb-toggle-form button'),
            function (button) { button.disabled = true; }
          );
        }, 0);
      });
    });
  })();
  </script>
</body>
</html>
`;
}
