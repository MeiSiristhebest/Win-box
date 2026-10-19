import { createServer } from 'node:http';

/** Deterministic MacCMS, multi-repository and live fixtures served on an ephemeral loopback port. */
export async function startAcceptanceFixture() {
  let base = '';
  let media = Buffer.alloc(0);
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    requests.push({ path: url.pathname, range: request.headers.range || '' });
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-store');
    const json = value => { response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(value)); };
    if (url.pathname === '/repos.json') return json({ urls: [{ name: '验收甲仓', url: base + '/a.json' }, { name: '验收乙仓', url: base + '/b.json' }] });
    if (url.pathname === '/a.json' || url.pathname === '/b.json') {
      const id = url.pathname[1];
      return json({ sites: [{ key: 'shared-site', name: `验收${id === 'a' ? '甲' : '乙'}站点`, type: 1, api: base + `/${id}-api` }], lives: [{ name: '验收直播', type: 0, url: base + '/live.txt' }] });
    }
    if (url.pathname === '/a-api' || url.pathname === '/b-api') {
      const id = url.pathname[1];
      return json({ code: 1, class: [{ type_id: 'movies', type_name: '验收分类' }], list: [{ vod_id: `${id}-video`, vod_name: `${id === 'a' ? '甲' : '乙'}仓验收视频`, vod_pic: '', vod_remarks: '本地生成', vod_play_from: 'fixture', vod_play_url: `第1集$${base}/clip.webm` }], page: 1, pagecount: 1, total: 1, limit: 20 });
    }
    if (url.pathname === '/live.txt') { response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end(`验收分组,#genre#\n验收频道,${base}/clip.webm\n`); return; }
    if (url.pathname === '/clip.webm') {
      response.setHeader('Content-Type', 'video/webm'); response.setHeader('Accept-Ranges', 'bytes');
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Math.min(media.length - 1, Number(match[2])) : media.length - 1;
      if (!media.length || start >= media.length || start > end) { response.writeHead(416, { 'Content-Range': `bytes */${media.length}` }); response.end(); return; }
      if (match) response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${media.length}`, 'Content-Length': end - start + 1 });
      else response.writeHead(200, { 'Content-Length': media.length });
      response.end(media.subarray(start, end + 1)); return;
    }
    response.writeHead(404); response.end('fixture missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, requests, setMedia(value) { media = Buffer.from(value); }, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
