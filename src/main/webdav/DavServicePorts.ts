import type { DavServer } from '../../shared/webdav';
import type { HttpClient, Logger } from '../../shared/types';

export type DavHttpPort = Pick<HttpClient, 'request'>;
export type DavLoggerPort = Pick<Logger, 'i' | 'w'>;

export interface DavServerRepositoryPort {
  list(): DavServer[];
  get(id: string): DavServer | null;
  set(server: DavServer): DavServer;
  remove(id: string): void;
}
