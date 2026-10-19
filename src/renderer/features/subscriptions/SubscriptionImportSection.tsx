import { useRef } from 'react';
import { AppModal } from '../../components/AppDialog';
import type { useSubscriptionImport } from './useSubscriptionImport';

type ImportFlow = ReturnType<typeof useSubscriptionImport>;

interface SubscriptionImportSectionProps {
  active: boolean;
  flow: ImportFlow;
  error: string;
  notice: string;
  onErrorClear: () => void;
}

export function SubscriptionImportSection({ active, flow, error, notice, onErrorClear }: SubscriptionImportSectionProps) {
  const { busy, job, jobHidden, importRunning } = flow;
  const packageNameInputRef = useRef<HTMLInputElement>(null);
  const liveNameInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      {job && jobHidden && (
        <button className='linkbtn' onClick={() => flow.setJobHidden(false)}>显示导入进度</button>
      )}
      {job && !jobHidden && (
        <output className='card' aria-live='polite' style={{ display: 'block', padding: 12, marginBottom: 16 }}>
          <div className='row' style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{job.name || job.url}</strong>
            <span>{job.state === 'resolving' ? '读取清单' : job.state === 'running' ? '导入中' : job.state === 'completed' ? '已完成' : job.state === 'partial' ? '部分完成' : job.state === 'cancelled' ? '已取消' : job.state === 'interrupted' ? '已中断' : '失败'}</span>
          </div>
          <div className='muted' style={{ marginTop: 4 }}>
            完成 {job.completed}/{job.total}，成功 {job.succeeded}，失败 {job.failed}，待处理 {job.pending}
            {job.currentName ? '；当前：' + job.currentName : ''}
          </div>
          {job.message && <div style={{ marginTop: 4, fontSize: 12, overflowWrap: 'anywhere' }}>{job.message}</div>}
          <div className='row' style={{ marginTop: 8 }}>
            {importRunning && <button onClick={() => void flow.cancelImport()}>取消导入</button>}
            {job.state === 'interrupted' && <button disabled={busy} onClick={() => void flow.resumeInterruptedImport()}>恢复中断任务</button>}
            {!importRunning && job.state !== 'interrupted' && job.failed > 0 && <button disabled={busy} onClick={() => void flow.resumeImport('failed')}>重试失败项</button>}
            {!importRunning && job.state !== 'interrupted' && job.pending > 0 && <button disabled={busy} onClick={() => void flow.resumeImport('pending')}>继续待处理项</button>}
            <button className='linkbtn' onClick={() => flow.setJobHidden(true)}>隐藏进度</button>
          </div>
        </output>
      )}

      {active && (
        <>
          <div className='card' id='cfg-import' style={{ padding: 12, marginBottom: 16 }}>
            <div className='row' style={{ marginBottom: 10 }}>
              <input
                style={{ width: 170, flex: '0 0 170px' }}
                placeholder='订阅名称（可选）'
                value={flow.name}
                onChange={(event) => flow.setName(event.target.value)}
              />
              <input
                style={{ flex: 1, minWidth: 260 }}
                placeholder='配置地址（http(s)://…）'
                value={flow.url}
                onChange={(event) => flow.setUrl(event.target.value)}
              />
              <button
                className='primary'
                disabled={busy || importRunning || !flow.url.trim()}
                onClick={() => void flow.importUrl()}
                title='多仓地址会建立订阅组，每个子仓单独保存为配置档案。超大清单分批处理，完成后可继续待处理项。地址尾加 #line=N 可单独导入一条线路。'
              >
                {busy ? '导入中…' : '从地址导入'}
              </button>
            </div>
            <div className='muted' style={{ fontSize: 12, margin: '-4px 0 10px' }}>
              多仓地址会自动导入并分组保存。大清单分批处理；进度卡片可取消、重试失败项或继续待处理项。
            </div>
            <div className='row' style={{ marginTop: 4 }}>
              <button disabled={busy || importRunning} onClick={() => void flow.importJsonLocal()}>导入本地 .json 文件</button>
              <button disabled={busy || importRunning} onClick={() => void flow.importPyLocal()}>导入本地 .py 文件</button>
              <button disabled={busy || importRunning} onClick={() => void flow.importPackage()} title='可选择仅含 .py 文件的文件夹，自动在应用副本中生成订阅 JSON'>导入本地包</button>
              <button disabled={busy || importRunning} onClick={() => void flow.importLiveLocal()} title='选择本地 .txt / .m3u / .m3u8 直播源文件；导入后到「直播」页顶部线路下拉切换'>导入直播源（TXT / M3U）</button>
            </div>
            {notice && <div className='status' style={{ marginBottom: 8 }}>✅ {notice}</div>}
            {error && <div className='err' style={{ marginBottom: 8 }}>操作失败：{error}</div>}
            {flow.warnings.length > 0 && <div className='banner'>⚠ {flow.warnings.join('；')}</div>}
            {flow.report && (
              <div className='status'>
                最近一次导入：共 {flow.report.total} 条 —— ✅ {flow.report.ok} · ⏭ {flow.report.skipped} · ⚠️ {flow.report.degraded}
              </div>
            )}
          </div>

          {flow.report && flow.report.items.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px' }}>导入诊断（最近一次）</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                    <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>key</th>
                    <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>name</th>
                    <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>type</th>
                    <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>状态</th>
                    <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>api</th>
                  </tr>
                </thead>
                <tbody>
                  {flow.report.items.map((item) => (
                    <tr key={item.index}>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>{item.key}</td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>{item.name}</td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>{item.type}</td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
                        {item.status === 'OK'
                          ? <span style={{ color: 'var(--accent-2)' }}>可用</span>
                          : <span style={{ color: 'var(--warn)' }} title={item.message}>{item.message}</span>}
                      </td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.api}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {flow.packageNamePrompt && (
        <AppModal
          open
          className='app-dialog card modal-in app-dialog-form'
          titleId='local-package-name-title'
          descriptionId='local-package-name-description'
          initialFocusRef={packageNameInputRef}
          canClose={!busy}
          onClose={() => flow.setPackageNamePrompt(null)}
        >
          <div className='app-dialog-heading'>
            <span className='app-dialog-mark' aria-hidden='true'>i</span>
            <h2 id='local-package-name-title'>命名本地 Python 包</h2>
          </div>
          <div className='app-dialog-message' id='local-package-name-description'>
            此文件夹只包含 Python 源文件，应用会在托管副本中自动生成订阅 JSON。请输入文件名；原始文件夹不会被修改。
          </div>
          <input
            ref={packageNameInputRef}
            value={flow.packageNamePrompt.name}
            disabled={busy}
            aria-label='生成的 JSON 文件名'
            placeholder='例如：我的 Python 源'
            onChange={(event) => { onErrorClear(); flow.setPackageNamePrompt({ ...flow.packageNamePrompt!, name: event.target.value }); }}
            onKeyDown={(event) => { if (event.key === 'Enter') void flow.confirmPackageName(); }}
            className='app-dialog-input'
          />
          {error && <div role='alert' className='err app-dialog-error'>{error}</div>}
          <div className='app-dialog-actions'>
            <button className='app-dialog-action-secondary' disabled={busy} onClick={() => flow.setPackageNamePrompt(null)}>取消</button>
            <button className='primary' disabled={busy || !flow.packageNamePrompt.name.trim()} onClick={() => void flow.confirmPackageName()}>
              {busy ? '导入中…' : '确认导入'}
            </button>
          </div>
        </AppModal>
      )}

      {flow.liveNamePrompt && (
        <AppModal
          open
          className='app-dialog card modal-in app-dialog-form'
          titleId='local-live-name-title'
          descriptionId='local-live-name-description'
          initialFocusRef={liveNameInputRef}
          canClose={!busy}
          onClose={() => flow.setLiveNamePrompt(null)}
        >
          <div className='app-dialog-heading'>
            <span className='app-dialog-mark' aria-hidden='true'>i</span>
            <h2 id='local-live-name-title'>命名本地直播源</h2>
          </div>
          <div className='app-dialog-message' id='local-live-name-description'>
            已选好 TXT / M3U 直播源文件；请给这条直播线路起个名字（默认取原始文件名）。原始文件不会被修改。
          </div>
          <input
            ref={liveNameInputRef}
            value={flow.liveNamePrompt.name}
            disabled={busy}
            aria-label='直播线路名称'
            placeholder='例如：我的直播源'
            onChange={(event) => { onErrorClear(); flow.setLiveNamePrompt({ ...flow.liveNamePrompt!, name: event.target.value }); }}
            onKeyDown={(event) => { if (event.key === 'Enter') void flow.confirmLiveName(); }}
            className='app-dialog-input'
          />
          {error && <div role='alert' className='err app-dialog-error'>{error}</div>}
          <div className='app-dialog-actions'>
            <button className='app-dialog-action-secondary' disabled={busy} onClick={() => flow.setLiveNamePrompt(null)}>取消</button>
            <button className='primary' disabled={busy || !flow.liveNamePrompt.name.trim()} onClick={() => void flow.confirmLiveName()}>
              {busy ? '导入中…' : '确认导入'}
            </button>
          </div>
        </AppModal>
      )}
    </>
  );
}
