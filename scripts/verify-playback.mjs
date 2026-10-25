import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import electronPath from 'electron';
import { _electron } from 'playwright-core';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { prepareMpvAcceptanceRuntime } from './acceptance-runtime.mjs';
import { startAcceptanceFixture } from './acceptance-fixture.mjs';
import { verifySourceMatrix } from './source-acceptance.mjs';
import { withWebmDuration } from './webm-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function assertRelayPortFree() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(9978, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}

async function showConfigTab(page, name) {
  await page.evaluate(() => { location.hash = '#/config'; });
  await page.getByRole('tab', { name, exact: true }).click();
}

async function selectKernel(player, label) {
  await player.locator('.vplayer').hover();
  await player.getByRole('button', { name: /^播放方式：/ }).click();
  await player.getByRole('button', { name: label, exact: true }).click();
}


async function call(page, namespace, method, ...args) {
  return page.evaluate(async ({ namespace, method, args }) => {
    const result = await window.api[namespace][method](...args);
    if (!result?.ok) throw new Error(result?.error?.message || result?.error || `${namespace}.${method} failed`);
    if (result.data?.ok === false) throw new Error(result.data.error || result.data.reason || `${namespace}.${method} refused`);
    return result.data;
  }, { namespace, method, args });
}

async function generateVideo(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 100_000 });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    let frame = 0;
    const interval = setInterval(() => {
      context.fillStyle = `hsl(${frame++ * 7 % 360} 65% 45%)`; context.fillRect(0, 0, 320, 180);
      context.fillStyle = '#ffffff'; context.font = '24px sans-serif'; context.fillText('Win-Box acceptance', 24, 90);
    }, 80);
    const result = new Promise(resolve => { recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()))); });
    recorder.start(200);
    const started = performance.now();
    await new Promise(resolve => setTimeout(resolve, 14000));
    const durationMs = performance.now() - started;
    recorder.stop(); clearInterval(interval); stream.getTracks().forEach(track => track.stop());
    return { bytes: await result, durationMs };
  });
}

export async function verifyPlayback() {
  if (process.platform !== 'win32') throw new Error('Embedded MPV acceptance requires Windows.');
  await assertRelayPortFree();
  await mkdir(join(ROOT, '.tmp'), { recursive: true });
  const directory = await mkdtemp(join(ROOT, '.tmp', 'playback-acceptance-'));
  const fixture = await startAcceptanceFixture();
  const steps = [];
  const errors = [];
  const cleanupErrors = [];
  let runtime;
  let application;
  let applicationProcess;
  let failure;
  const applicationOutput = { stdout: '', stderr: '' };
  const report = { recordedAt: new Date().toISOString(), steps, rendererErrors: errors, externalThirdPartySources: 'NOT_RUN' };
  const record = (name, evidence = {}) => { steps.push({ name, status: 'PASS', ...evidence }); console.log(`PASS ${name}`); };
  try {
    runtime = await prepareMpvAcceptanceRuntime();
    report.mpv = { version: runtime.version, source: runtime.source, archiveSha256: runtime.archiveSha256, executableSha256: runtime.executableSha256 };
    const environment = { ...process.env, NODE_ENV: 'production', WINBOX_DEV_USER_DATA: join(directory, 'userData') };
    delete environment.ELECTRON_RUN_AS_NODE; delete environment.WINBOX_DEV_RELOAD_PIPE;
    application = await _electron.launch({ executablePath: electronPath, args: [ROOT, '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'], cwd: ROOT, env: environment, timeout: 30_000 });
    applicationProcess = application.process();
    for (const channel of ['stdout', 'stderr']) {
      applicationProcess[channel]?.on('data', chunk => {
        applicationOutput[channel] = (applicationOutput[channel] + chunk.toString()).slice(-12_000);
      });
    }
    report.electronPid = applicationProcess.pid;
    const main = await application.firstWindow();
    main.on('pageerror', error => errors.push(error.message));
    await main.waitForFunction(() => !!window.api?.config?.cfgGet);
    await main.evaluate(() => { localStorage.setItem('winbox-disclaim-agreed', '1'); localStorage.setItem('winbox-player-prefs', JSON.stringify({ kernel: 'html5', vol: 0, rate: 1, subOffset: 0, fit: 'contain', spdif: '' })); });
    await call(main, 'system', 'updateUiPreferences', { showDiscover: false, navMode: 'inline' });
    await call(main, 'playerPrefs', 'set', { mpvPath: runtime.path });
    await main.reload();
    await main.waitForFunction(() => !!window.api?.config?.cfgGet);
    console.log('Generating local video fixture');
    const captured = await generateVideo(main);
    const media = withWebmDuration(captured.bytes, captured.durationMs);
    assert.ok(media.length > 1000, 'MediaRecorder did not generate a video');
    fixture.setMedia(media);
    record('generated-local-video', { bytes: media.length, codec: 'VP8', width: 320, height: 180, durationMs: captured.durationMs });
    await call(main, 'config', 'importUrl', fixture.base + '/repos.json');
    let config = await call(main, 'config', 'cfgGet');
    const profileA = config.profiles.find(item => item.apiUrl === fixture.base + '/a.json');
    const profileB = config.profiles.find(item => item.apiUrl === fixture.base + '/b.json');
    assert.ok(profileA && profileB, 'Multi-repository import did not retain both profiles');
    await call(main, 'config', 'activateProfile', profileA.id);
    await call(main, 'config', 'deleteSource', 'shared-site');
    assert.equal((await call(main, 'config', 'cfgGet')).sources.length, 0);
    await call(main, 'config', 'activateProfile', profileB.id);
    config = await call(main, 'config', 'cfgGet');
    assert.equal(config.sources.length, 1, 'Deleting A removed the same-key source from B');
    assert.equal(config.sources[0].name, '验收乙站点');
    record('same-key-profile-deletion-isolation', { profiles: 2, deletedProfileSourceCount: 0, otherProfileSourceCount: config.sources.length });

    await main.evaluate(() => { location.hash = '#/config'; });
    await main.getByRole('checkbox', { name: '选择源 验收乙站点', exact: true }).check();
    await main.getByRole('button', { name: '全局屏蔽所选', exact: true }).click();
    await main.getByRole('alertdialog', { name: '全局屏蔽所选源', exact: true }).getByRole('button', { name: '全局屏蔽', exact: true }).click();
    await main.waitForFunction(async () => (await window.api.config.cfgGet()).data.sources.length === 0);
    await main.getByText('全局屏蔽列表（1）', { exact: true }).click();
    await main.getByRole('button', { name: '解除全局屏蔽 shared-site', exact: true }).click();
    await main.waitForFunction(async () => (await window.api.config.cfgGet()).data.sources.length === 1);
    record('global-block-and-unblock-settings-ui', { restoredSourceCount: 1, scopedDeletionRemainsIndependent: true });

    const playerEvent = application.waitForEvent('window');
    await call(main, 'player', 'open', {
      key: 'shared-site', flag: 'fixture', episodes: [{ name: '第1集', url: fixture.base + '/clip.webm' }, { name: '第2集', url: fixture.base + '/clip.webm?ep=2' }],
      epIndex: 0, title: '本地验收视频', lastUrl: fixture.base + '/clip.webm', lastName: '本地验收视频 - 第1集',
      meta: { profileId: profileB.id, fromKey: 'shared-site', vodId: 'b-video', sourceName: '验收乙站点' },
    });
    const player = await playerEvent;
    player.on('pageerror', error => errors.push(error.message));
    await player.waitForURL(url => url.hash === '#/player');
    await player.waitForFunction(() => { const video = document.querySelector('video'); return video?.videoWidth === 320 && video.currentTime > 0.5; }, null, { timeout: 30_000 });
    await player.locator('.vplayer').hover();
    await player.locator('.vp-ctl[title="暂停"]').click();
    await player.waitForFunction(() => document.querySelector('video')?.paused === true);
    const html5 = await player.locator('video').evaluate(video => ({ time: video.currentTime, width: video.videoWidth, height: video.videoHeight, paused: video.paused }));
    record('html5-real-video-and-pause', html5);
    await player.evaluate(() => { window.__acceptanceMpvEvents = []; window.api.mpv.onState(event => { window.__acceptanceMpvState = event; window.__acceptanceMpvEvents.push(event); if (window.__acceptanceMpvEvents.length > 200) window.__acceptanceMpvEvents.shift(); }); });
    await selectKernel(player, '兼容播放');
    await player.waitForFunction(() => { const state = window.__acceptanceMpvState?.state; return state?.loaded && state.videoW === 320 && state.paused; }, null, { timeout: 30_000 });
    await call(player, 'mpv', 'cmd', { type: 'seek', value: 2 });
    await player.waitForFunction(() => window.__acceptanceMpvState?.state.time >= 1.8);
    await call(player, 'mpv', 'cmd', { type: 'play' });
    await player.waitForFunction(() => { const state = window.__acceptanceMpvState?.state; return state?.time > 3 && !state.paused; });
    await call(player, 'mpv', 'cmd', { type: 'pause' });
    await player.waitForFunction(() => window.__acceptanceMpvState?.state.paused === true);
    const mpv = await player.evaluate(() => window.__acceptanceMpvState);
    assert.ok(mpv.state.videoW === 320 && mpv.state.videoH === 180 && mpv.state.time > 3);
    await player.screenshot({ path: join(ROOT, '.tmp/playback-acceptance-mpv.png') });
    record('mpv-real-decode-seek-play-pause', { session: mpv.session, time: mpv.state.time, width: mpv.state.videoW, height: mpv.state.videoH, paused: mpv.state.paused });
    await selectKernel(player, '自动选择（推荐）');
    await player.waitForFunction(() => JSON.parse(localStorage.getItem('winbox-player-prefs') || '{}').kernel === 'auto');
    await player.waitForFunction(() => { const video = document.querySelector('video'); return video?.videoWidth === 320 && video.paused && video.currentTime > 2; });
    record('restore-auto-and-preserve-paused-position', await player.locator('video').evaluate(video => ({ time: video.currentTime, paused: video.paused })));

    await call(main, 'playerPrefs', 'set', { kernel: 'html5' });
    await player.close();
    await main.waitForFunction(async () => !(await window.api.player.isOpen()).data.open);
    const deniedPlayerEvent = application.waitForEvent('window');
    await call(main, 'player', 'open', {
      key: 'shared-site', flag: 'fixture', episodes: [{ name: '403 HLS', url: fixture.base + '/denied.m3u8' }],
      epIndex: 0, title: '403 HLS 验收', lastUrl: fixture.base + '/denied.m3u8', lastName: '403 HLS 验收',
      meta: { profileId: profileB.id, fromKey: 'shared-site', vodId: '403-hls', sourceName: '验收乙站点' },
    });
    const deniedPlayer = await deniedPlayerEvent;
    await deniedPlayer.waitForURL(url => url.hash === '#/player');
    await deniedPlayer.getByText(/HLS 播放失败.*HTTP 403/).waitFor({ timeout: 15_000 });
    const hls403Message = await deniedPlayer.locator('body').innerText();
    assert.ok(!hls403Message.includes('PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE'));
    const hlsRequest = fixture.requests.find(request => request.path === '/denied.m3u8');
    assert.equal(hlsRequest?.range, '', 'Electron must request HLS manifests through hls.js instead of native media demuxing');
    record('hls-http-403-reported-as-source-error', { httpStatus: 403, messageContainsHlsFailure: hls403Message.includes('HLS 播放失败'), requestUsedHlsLoader: hlsRequest?.range === '' });
    await deniedPlayer.close();
    await main.waitForFunction(async () => !(await window.api.player.isOpen()).data.open);

    const pluginDir = join(directory, 'dialog-plugin');
    await mkdir(pluginDir);
    await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify({ manifestVersion: 1, id: 'acceptance-dialog', name: '验收对话插件', version: '1.0.0', apiVersion: '1.x', kind: 'code', main: 'main.js', permissions: ['dialog'], contributes: [] }));
    await writeFile(join(pluginDir, 'main.js'), "void winbox.dialog.confirm('验收确认内容', '验收确认').then(answer => winbox.dialog.alert('插件收到结果：' + answer, '验收返回')); ");
    const pluginArchive = join(directory, 'acceptance-dialog.winbox');
    const pluginZip = new ZipWriter(new Uint8ArrayWriter());
    for (const name of ['plugin.json', 'main.js']) await pluginZip.add(name, new Uint8ArrayReader(await readFile(join(pluginDir, name))));
    await writeFile(pluginArchive, await pluginZip.close());
    await main.evaluate(() => {
      window.__acceptancePluginDialogRequests = [];
      window.api.plugins.onDialog(request => window.__acceptancePluginDialogRequests.push(request));
    });
    await call(main, 'plugins', 'install', { path: pluginArchive });
    await call(main, 'plugins', 'setEnabled', { id: 'acceptance-dialog', enabled: true });
    const pluginState = (await call(main, 'plugins', 'list')).find(item => item.id === 'acceptance-dialog');
    report.pluginState = pluginState;
    assert.ok(pluginState?.sandbox?.running, `Acceptance plugin sandbox did not start: ${JSON.stringify(pluginState)}`);
    await main.waitForFunction(() => window.__acceptancePluginDialogRequests?.length > 0, null, { timeout: 15_000 });
    report.pluginDialogRequests = await main.evaluate(() => window.__acceptancePluginDialogRequests);
    const prompt = main.getByRole('alertdialog', { name: 'acceptance-dialog · 验收确认' });
    await prompt.waitFor({ timeout: 15_000 });
    await prompt.getByRole('button', { name: '确定', exact: true }).click();
    const answer = main.getByRole('dialog', { name: 'acceptance-dialog · 验收返回' });
    await answer.waitFor();
    assert.ok(await answer.getByText('插件收到结果：true', { exact: true }).isVisible());
    await answer.getByRole('button').click();
    await call(main, 'plugins', 'setEnabled', { id: 'acceptance-dialog', enabled: false });
    await call(main, 'plugins', 'uninstall', 'acceptance-dialog');
    record('sandbox-plugin-in-app-confirm-and-answer');

    // Seed a distinct saved progress record, export it through the real settings UI, then load a newer in-memory view.
    const savedUrl = fixture.base + '/saved-history.webm';
    const historyKey = 'p:' + profileB.id + ':k:shared-site:saved-video';
    const savedHistory = { name: '备份验收视频 - 第1集', url: savedUrl, rawUrl: savedUrl, sourceKey: 'shared-site', profileId: profileB.id, vodId: 'saved-video', time: 21, updatedAt: Date.now() - 20_000 };
    const savedMemory = { home: { key: 'shared-site', profileId: profileB.id, tid: '', pg: 1, scrollTop: 0 }, detail: [], playTime: [[savedUrl, 21]], history: [[historyKey, savedHistory]], deleted: [] };
    await main.evaluate(memory => { localStorage.setItem('tvboxUiMemory', JSON.stringify(memory)); localStorage.setItem('acceptance-backup-sentinel', 'saved'); }, savedMemory);
    await main.reload();
    await main.waitForFunction(() => !!window.api?.backup);
    const backupPath = join(directory, 'settings backup.json');
    await application.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, backupPath);
    await showConfigTab(main, '备份');
    await main.getByRole('button', { name: '导出设置备份', exact: true }).click();
    await main.getByText('已导出到：' + backupPath, { exact: true }).waitFor();
    const exported = JSON.parse(await readFile(backupPath, 'utf8'));
    const exportedMemory = JSON.parse(exported.renderer.tvboxUiMemory);
    assert.equal(exportedMemory.history.find(([key]) => key === historyKey)[1].time, 21);
    const newerMemory = { ...savedMemory, history: [[historyKey, { ...savedHistory, time: 77, updatedAt: Date.now() }]] };
    await main.evaluate(memory => { localStorage.setItem('tvboxUiMemory', JSON.stringify(memory)); localStorage.setItem('acceptance-unsaved-key', 'remove-on-restore'); localStorage.setItem('acceptance-backup-sentinel', 'newer'); }, newerMemory);
    await call(main, 'playerPrefs', 'set', { m3u8Purify: true });
    await main.reload();
    await main.waitForFunction(() => !!window.api?.backup);
    await showConfigTab(main, '备份');
    const reloaded = main.waitForEvent('load');
    await main.getByRole('button', { name: '导入设置备份', exact: true }).click();
    await main.getByRole('alertdialog', { name: '导入设置备份' }).getByRole('button', { name: '继续导入', exact: true }).click();
    await reloaded;
    await main.waitForFunction(() => !!window.api?.backup);
    await delay(6000); // Let old debounced/periodic writers attempt their next write.
    const restored = await main.evaluate(() => ({ memory: JSON.parse(localStorage.getItem('tvboxUiMemory')), sentinel: localStorage.getItem('acceptance-backup-sentinel'), extra: localStorage.getItem('acceptance-unsaved-key') }));
    assert.equal(restored.memory.history.find(([key]) => key === historyKey)[1].time, 21, 'Newer in-memory progress overwrote the backup');
    assert.equal(restored.sentinel, 'saved'); assert.equal(restored.extra, null);
    assert.equal((await call(main, 'playerPrefs', 'get')).m3u8Purify, false);
    assert.equal((await call(main, 'player', 'isOpen')).open, false);
    record('backup-ui-restores-older-history-progress-and-settings', { restoredTime: 21, absentKeyRemoved: true, playerClosed: player.isClosed(), staleWriterObservationMs: 6000 });
    assert.deepEqual(errors, [], 'Renderer produced an unhandled error');
    const matrixIndex = process.argv.indexOf('--source-matrix');
    if (matrixIndex !== -1) {
      assert.ok(process.argv[matrixIndex + 1], '--source-matrix requires a JSON file path.');
      report.externalThirdPartySources = await verifySourceMatrix(main, call, resolve(process.argv[matrixIndex + 1]), ROOT);
    }
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = error.stack || String(error);
    failure = error;
    report.applicationOutput = applicationOutput;
    try {
      if (application) report.windowStates = await Promise.all(application.windows().map(async page => ({ url: page.url(), state: await page.evaluate(() => ({ video: (() => { const v = document.querySelector('video'); return v ? { time: v.currentTime, duration: v.duration, paused: v.paused, ready: v.readyState, width: v.videoWidth, error: v.error?.message } : null; })(), prefs: localStorage.getItem('winbox-player-prefs'), mpv: window.__acceptanceMpvState, text: document.body.innerText.slice(-3000) })).catch(() => null) })));
    } catch (snapshotError) {
      cleanupErrors.push({ action: 'capture-window-state', error: String(snapshotError) });
    }
  } finally {
    const cleanup = async (action, run) => {
      try {
        await run();
      } catch (error) {
        cleanupErrors.push({ action, error: String(error) });
      }
    };
    if (application) {
      await cleanup('close-electron', () => application.close());
      if (applicationProcess && applicationProcess.exitCode === null && applicationProcess.signalCode === null) {
        await cleanup('wait-electron-exit', async () => {
          await Promise.race([new Promise(resolve => applicationProcess.once('exit', resolve)), delay(5000)]);
        });
      }
      if (applicationProcess && applicationProcess.exitCode === null && applicationProcess.signalCode === null) {
        await cleanup('terminate-electron', () => {
          if (!applicationProcess.kill()) throw new Error(`Could not terminate acceptance Electron process ${applicationProcess.pid}.`);
        });
        await cleanup('wait-electron-termination', async () => {
          if (applicationProcess.exitCode === null && applicationProcess.signalCode === null) {
            await Promise.race([new Promise(resolve => applicationProcess.once('exit', resolve)), delay(5000)]);
          }
          if (applicationProcess.exitCode === null && applicationProcess.signalCode === null) {
            throw new Error(`Acceptance Electron process ${applicationProcess.pid} is still running.`);
          }
        });
      }
    }
    await cleanup('close-fixture-server', () => fixture.close());
    report.fixtureRequests = fixture.requests;
    report.processExited = !applicationProcess || applicationProcess.exitCode !== null || applicationProcess.signalCode !== null;
    const removeOwned = async path => {
      const rel = relative(join(ROOT, '.tmp'), resolve(path));
      assert.ok(rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel) && /^(mpv-acceptance-|playback-acceptance-)/.test(rel), 'Refusing cleanup outside owned acceptance directory');
      for (let attempt = 0; attempt < 15; attempt++) {
        try { await rm(path, { recursive: true, force: true }); return; } catch (error) { if (attempt === 14) throw error; await delay(200); }
      }
    };
    if (runtime) await cleanup('remove-mpv-runtime', () => removeOwned(runtime.directory));
    await cleanup('remove-session-directory', () => removeOwned(directory));
    report.cleaned = cleanupErrors.length === 0;
    if (cleanupErrors.length) {
      report.status = 'FAIL';
      report.cleanupErrors = cleanupErrors;
      report.error ??= cleanupErrors.map(item => `${item.action}: ${item.error}`).join('\n');
    }
    try {
      await writeFile(join(ROOT, '.tmp/playback-acceptance.json'), JSON.stringify(report, null, 2));
    } catch (reportError) {
      cleanupErrors.push({ action: 'write-acceptance-report', error: String(reportError) });
      console.error('Could not write playback acceptance report:', reportError);
      failure ??= reportError;
    }
  }
  if (failure) throw failure;
  if (report.status !== 'PASS') throw new Error(report.error || 'Playback acceptance failed.');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyPlayback(), null, 2));
