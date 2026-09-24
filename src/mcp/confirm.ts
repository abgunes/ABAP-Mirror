import * as vscode from 'vscode';
import { summarizeLineChanges } from './diffSummary';
import { ConfirmAction, Confirmer, ConfirmRequest } from './types';

// Modal VS Code confirmation for MCP write actions, with an optional
// read-only diff of current vs proposed source.

const DIFF_SCHEME = 'abap-mirror-mcp-diff';

const VERB: Record<ConfirmAction, string> = {
  write: 'save',
  write_activate: 'save and activate',
  activate: 'activate',
  lock: 'lock',
  unlock: 'unlock',
};

export function createVsCodeConfirmer(): Confirmer & vscode.Disposable {
  const contents = new Map<string, string>();
  let sequence = 0;
  const provider = vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, {
    provideTextDocumentContent: (uri) => contents.get(uri.path) ?? '',
  });

  async function showDiff(request: ConfirmRequest): Promise<void> {
    const id = ++sequence;
    const left = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${id}/current/${request.objectLabel}.abap` });
    const right = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${id}/proposed/${request.objectLabel}.abap` });
    contents.set(left.path, request.currentSource ?? '');
    contents.set(right.path, request.proposedSource ?? '');
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${request.objectLabel}: current ↔ proposed by MCP client`,
      { preview: true }
    );
  }

  return {
    async confirm(request: ConfirmRequest): Promise<boolean> {
      const hasDiff = request.currentSource !== undefined && request.proposedSource !== undefined;
      let detail = `System: ${request.destination}`;
      if (hasDiff) {
        const { added, removed } = summarizeLineChanges(request.currentSource ?? '', request.proposedSource ?? '');
        detail += `\nChange: +${added} / -${removed} lines`;
      }
      const question = `An MCP client wants to ${VERB[request.action]} ${request.objectLabel}.`;
      const buttons = hasDiff ? ['Allow', 'Show Diff'] : ['Allow'];
      const choice = await vscode.window.showWarningMessage(question, { modal: true, detail }, ...buttons);
      if (choice !== 'Show Diff') return choice === 'Allow';
      // A modal would block scrolling the diff, so ask again non-modally.
      await showDiff(request);
      const afterDiff = await vscode.window.showWarningMessage(
        `${question} (${request.destination}) Review the diff, then decide.`,
        'Allow',
        'Deny'
      );
      return afterDiff === 'Allow';
    },
    dispose(): void {
      provider.dispose();
      contents.clear();
    },
  };
}
