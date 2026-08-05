import * as vscode from 'vscode';
import { DEFAULT_TYPE_ICONS, TypeIconConfig } from './typeIconSvg';
import { getOrCreateIconFile, clearIconCache } from './typeIconCache';

export class TypeIconResolver {
  constructor(private readonly cacheDir: string) {}

  isEnabled(): boolean {
    return vscode.workspace.getConfiguration('abapMirror').get('icons.enableInMirrorPanel', true);
  }

  private getConfiguredIcons(): TypeIconConfig[] {
    return vscode.workspace.getConfiguration('abapMirror').get('typeIcons', DEFAULT_TYPE_ICONS);
  }

  getIconUri(objectType: string, dirty: boolean): vscode.Uri | undefined {
    const icons = this.getConfiguredIcons();
    const match = icons.find(entry => entry.type === objectType) ?? icons.find(entry => entry.type === 'UNKNOWN');
    if (!match) return undefined;
    const filePath = getOrCreateIconFile(this.cacheDir, match.abbreviation, match.color, dirty);
    return vscode.Uri.file(filePath);
  }

  clearCache(): void {
    clearIconCache(this.cacheDir);
  }
}
