import { request } from 'undici';
import { extractBaiduSharedFile, type BaiduSharedFile } from '../net/baiduTransfer';

/** Reads the share session that a running spider JVM keeps for a selected file. */
export class BaiduJvmContextReader {
  async read(port: number, fsid: string): Promise<BaiduSharedFile | null> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^\d+$/.test(fsid)) return null;
    try {
      const response = await request(
        `http://127.0.0.1:${port}/proxy?do=winbox-baidu-context&fileId=${fsid}`,
        { headersTimeout: 5000, bodyTimeout: 5000 },
      );
      const text = await response.body.text();
      const file = response.statusCode === 200 ? extractBaiduSharedFile(text) : null;
      return file?.fsid === fsid ? file : null;
    } catch {
      return null;
    }
  }
}
