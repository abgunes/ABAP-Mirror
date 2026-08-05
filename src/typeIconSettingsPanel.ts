// src/typeIconSettingsPanel.ts
import * as vscode from 'vscode';
import { DEFAULT_TYPE_ICONS, TypeIconConfig } from './typeIconSvg';

export function openTypeIconSettingsPanel(): void {
  const panel = vscode.window.createWebviewPanel(
    'abapMirrorTypeIcons',
    'ABAP Mirror - Configure Type Icons',
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );

  const current = vscode.workspace.getConfiguration('abapMirror').get<TypeIconConfig[]>('typeIcons', DEFAULT_TYPE_ICONS);
  panel.webview.html = renderHtml(current);

  panel.webview.onDidReceiveMessage(async message => {
    if (message.command === 'save') {
      const rows = message.rows as TypeIconConfig[];
      await vscode.workspace
        .getConfiguration('abapMirror')
        .update('typeIcons', rows, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('ABAP Mirror: type icon settings saved.');
    }
  });
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
      <td><button class="remove-row">Remove</button></td>
    </tr>`;
}

function renderHtml(rows: TypeIconConfig[]): string {
  const rowsHtml = rows.map(renderRow).join('\n');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; }
  input[type="text"] { width: 100%; box-sizing: border-box; }
  button { margin: 8px 4px 0 0; }
</style>
</head>
<body>
  <h2>ABAP Mirror - Type Icons</h2>
  <p>One row per ABAP object type. "UNKNOWN" is the fallback used for anything not listed here.</p>
  <table id="icon-table">
    <thead><tr><th>Object type</th><th>Abbreviation</th><th>Color</th><th></th></tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  <button id="add-row">Add row</button>
  <button id="save">Save</button>
  <script>
    const vscode = acquireVsCodeApi();
    const tbody = document.querySelector('#icon-table tbody');

    document.getElementById('add-row').addEventListener('click', () => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><input class="type" type="text" value="" /></td>' +
        '<td><input class="abbreviation" type="text" maxlength="2" value="" /></td>' +
        '<td><input class="color" type="color" value="#6e7681" /></td>' +
        '<td><button class="remove-row">Remove</button></td>';
      tbody.appendChild(tr);
    });

    tbody.addEventListener('click', event => {
      if (event.target.classList.contains('remove-row')) {
        event.target.closest('tr').remove();
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
