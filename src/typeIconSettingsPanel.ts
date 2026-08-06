// src/typeIconSettingsPanel.ts
import * as vscode from 'vscode';
import { DEFAULT_TYPE_ICONS, TypeIconConfig } from './typeIconSvg';
import { normalizeTypeIcons } from './normalizeTypeIcons';

export function openTypeIconSettingsPanel(): void {
  const panel = vscode.window.createWebviewPanel(
    'abapMirrorTypeIcons',
    'ABAP Mirror - Configure Type Icons',
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );

  const rawCurrent = vscode.workspace.getConfiguration('abapMirror').get<TypeIconConfig[]>('typeIcons', DEFAULT_TYPE_ICONS);
  const current = normalizeTypeIcons(rawCurrent);
  panel.webview.html = renderHtml(panel.webview, current);

  panel.webview.onDidReceiveMessage(async message => {
    if (message.command === 'save') {
      const submitted = Array.isArray(message.rows) ? message.rows.length : 0;
      const normalized = normalizeTypeIcons(message.rows);
      await vscode.workspace
        .getConfiguration('abapMirror')
        .update('typeIcons', normalized, vscode.ConfigurationTarget.Global);
      const dropped = submitted - normalized.length;
      if (dropped > 0) {
        vscode.window.showWarningMessage(
          `ABAP Mirror: saved ${normalized.length} type icon(s); ${dropped} row(s) were ignored for an invalid type code, abbreviation, or color.`
        );
      } else {
        vscode.window.showInformationMessage('ABAP Mirror: type icon settings saved.');
      }
    }
  });
}

// VS Code webviews only run inline <script> content when the page's own
// Content-Security-Policy explicitly allows it (enableScripts: true just
// permits scripts in principle; it is not itself a permissive CSP). Without
// this nonce, every button in this panel (Add row, Copy, Remove, Save)
// silently does nothing, with no error visible anywhere outside the
// webview's own DevTools console.
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderRow(entry: TypeIconConfig): string {
  return `
    <tr>
      <td><input class="type" type="text" value="${escapeHtml(entry.type)}" /></td>
      <td><input class="abbreviation" type="text" maxlength="2" value="${escapeHtml(entry.abbreviation)}" /></td>
      <td><input class="color" type="color" value="${escapeHtml(entry.color)}" /></td>
      <td class="row-actions">
        <button class="copy-row" title="Copy this row">Copy</button>
        <button class="remove-row secondary" title="Remove this row">Remove</button>
      </td>
    </tr>`;
}

function renderHtml(webview: vscode.Webview, rows: TypeIconConfig[]): string {
  const nonce = getNonce();
  const rowsHtml = rows.map(renderRow).join('\n');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 16px 20px;
  }
  h2 { font-size: 1.3em; font-weight: 600; margin: 0 0 4px; }
  p.hint { color: var(--vscode-descriptionForeground); margin-top: 0; margin-bottom: 16px; }
  table {
    border-collapse: collapse;
    width: 100%;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 6px;
    overflow: hidden;
  }
  thead th {
    text-align: left;
    padding: 8px 10px;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    font-weight: 600;
    font-size: 0.9em;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  tbody td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  input[type="text"] {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
  }
  input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  input[type="color"] {
    width: 44px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    background: none;
    cursor: pointer;
  }
  .row-actions { white-space: nowrap; }
  button {
    padding: 5px 12px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    font-size: 0.9em;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .row-actions button { margin-right: 4px; }
  .toolbar { margin-top: 16px; display: flex; gap: 8px; }
</style>
</head>
<body>
  <h2>ABAP Mirror - Type Icons</h2>
  <p class="hint">One row per ABAP object type. "UNKNOWN" is the fallback used for anything not listed here.</p>
  <table id="icon-table">
    <thead><tr><th>Object type</th><th>Abbreviation</th><th>Color</th><th></th></tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  <div class="toolbar">
    <button id="add-row" class="secondary">Add row</button>
    <button id="save">Save</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const tbody = document.querySelector('#icon-table tbody');

    function createRow(type, abbreviation, color) {
      const tr = document.createElement('tr');

      const typeTd = document.createElement('td');
      const typeInput = document.createElement('input');
      typeInput.className = 'type';
      typeInput.type = 'text';
      typeInput.value = type;
      typeTd.appendChild(typeInput);

      const abbrTd = document.createElement('td');
      const abbrInput = document.createElement('input');
      abbrInput.className = 'abbreviation';
      abbrInput.type = 'text';
      abbrInput.maxLength = 2;
      abbrInput.value = abbreviation;
      abbrTd.appendChild(abbrInput);

      const colorTd = document.createElement('td');
      const colorInput = document.createElement('input');
      colorInput.className = 'color';
      colorInput.type = 'color';
      colorInput.value = color;
      colorTd.appendChild(colorInput);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'row-actions';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-row';
      copyBtn.title = 'Copy this row';
      copyBtn.textContent = 'Copy';
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-row secondary';
      removeBtn.title = 'Remove this row';
      removeBtn.textContent = 'Remove';
      actionsTd.appendChild(copyBtn);
      actionsTd.appendChild(removeBtn);

      tr.appendChild(typeTd);
      tr.appendChild(abbrTd);
      tr.appendChild(colorTd);
      tr.appendChild(actionsTd);
      return tr;
    }

    document.getElementById('add-row').addEventListener('click', () => {
      tbody.appendChild(createRow('', '', '#6e7681'));
    });

    tbody.addEventListener('click', event => {
      const target = event.target;
      if (target.classList.contains('remove-row')) {
        target.closest('tr').remove();
        return;
      }
      if (target.classList.contains('copy-row')) {
        const sourceRow = target.closest('tr');
        const type = sourceRow.querySelector('.type').value;
        const abbreviation = sourceRow.querySelector('.abbreviation').value;
        const color = sourceRow.querySelector('.color').value;
        sourceRow.after(createRow(type, abbreviation, color));
      }
    });

    document.getElementById('save').addEventListener('click', () => {
      const rows = Array.from(tbody.querySelectorAll('tr')).map(tr => ({
        type: tr.querySelector('.type').value.trim(),
        abbreviation: tr.querySelector('.abbreviation').value.trim(),
        color: tr.querySelector('.color').value,
      })).filter(row => row.type.length > 0);
      vscode.postMessage({ command: 'save', rows });
    });
  </script>
</body>
</html>`;
}
