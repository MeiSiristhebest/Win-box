import { describe, expect, it, vi } from 'vitest';
import type { HttpResponse } from '../src/shared/types';
import type { DavServer } from '../src/shared/webdav';
import type { DavHttpPort, DavLoggerPort, DavServerRepositoryPort } from '../src/main/webdav/DavServicePorts';
import { DavService } from '../src/main/webdav/DavService';

const server: DavServer = {
  id: 'dav-1',
  name: 'Test WebDAV',
  url: 'https://dav.example/dav',
  username: 'alice',
  password: 'secret',
};

const propfindResponse: HttpResponse = {
  status: 207,
  headers: {},
  finalUrl: 'https://dav.example/dav',
  content: `<?xml version="1.0" encoding="utf-8"?>
    <D:multistatus xmlns:D="DAV:">
      <D:response><D:href>/dav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
      <D:response><D:href>/dav/movie.mp4</D:href><D:propstat><D:prop><D:displayname>movie.mp4</D:displayname><D:getcontentlength>42</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
    </D:multistatus>`,
};

function setup() {
  const http: DavHttpPort = { request: vi.fn(async () => propfindResponse) };
  const repository: DavServerRepositoryPort = {
    list: vi.fn(() => [server]),
    get: vi.fn((id) => id === server.id ? server : null),
    set: vi.fn((value) => value),
    remove: vi.fn(),
  };
  const logger: DavLoggerPort = { i: vi.fn(), w: vi.fn() };
  return { service: new DavService(http, repository, logger), http, repository };
}

describe('DavService ports', () => {
  it('browses through the injected HTTP and repository ports', async () => {
    const { service, http, repository } = setup();

    await expect(service.browse(server.id)).resolves.toMatchObject({
      path: '/',
      entries: [{ name: 'movie.mp4', path: '/movie.mp4', isDir: false, size: 42 }],
    });

    expect(repository.get).toHaveBeenCalledWith(server.id);
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
      url: server.url,
      method: 'propfind',
      headers: expect.objectContaining({ Authorization: 'Basic YWxpY2U6c2VjcmV0' }),
      redirect: 0,
    }));
  });

  it('does not perform network I/O when the requested server is absent', async () => {
    const { service, http } = setup();

    await expect(service.browse('missing')).rejects.toThrow('该 WebDAV 服务器不存在');
    expect(http.request).not.toHaveBeenCalled();
  });
});
