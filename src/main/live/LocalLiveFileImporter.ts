import * as iconv from 'iconv-lite';
import { basename } from 'node:path';
import { nameFromLocalFile } from '../util/importNaming';
import { looksLikeLiveSourceText, sanitizeLiveFileName } from '../../engine/live/localLive';

export interface LocalLiveFileStoragePort {
  read(path: string): Buffer;
  /** Persist decoded content as UTF-8 under the application's local-live directory. */
  writeUtf8(fileName: string, text: string): void;
}

export interface LocalLiveImportResult {
  fileName: string;
  name: string;
  needsName: boolean;
}

/** Decodes, validates, and stores a user-selected TXT/M3U live source. */
export class LocalLiveFileImporter {
  constructor(private readonly storage: LocalLiveFileStoragePort) {}

  import(path: string, nameOverride: string): LocalLiveImportResult {
    const bytes = this.storage.read(path);
    if (!bytes.length) throw new Error('所选文件为空');

    // Prefer UTF-8; GB18030 is a common fallback for exported Chinese playlists.
    let text = bytes.toString('utf-8');
    if (text.includes('\uFFFD')) {
      try { text = iconv.decode(bytes, 'gb18030'); } catch { /* retain UTF-8 and validate below */ }
    }
    if (!looksLikeLiveSourceText(text)) {
      throw new Error('文件内容不像 TXT / M3U 直播源（需要 #EXTM3U 头、#genre# 分组行，或「频道名,http…」频道行）');
    }

    const fileName = sanitizeLiveFileName(basename(path));
    this.storage.writeUtf8(fileName, text);
    const name = nameOverride || nameFromLocalFile(path);
    return { fileName, name, needsName: !nameOverride };
  }
}
