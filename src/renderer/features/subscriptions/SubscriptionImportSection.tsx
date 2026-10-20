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
      {active && job && jobHidden && (
        <button className='linkbtn' onClick={() => flow.setJobHidden(false)}>显示导入进度</button>
      )}
      {active && job && !jobHidden && (
        <output className='card' aria-live='polite' style={{ display: 'block', padding: 12, marginBottom: 16 }}>
          <div className='row' style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{job.name || job.url}</strong>
            <span>{job.state === 'resolving' ? '读取清单' : job.state === 'running' ? '导入中' : job.state === 'completed' ? '已完成' : job.state === 'partial' ? '部分完成' : job.state === 'cancelled' ? '已取消' : job.state === 'interrupted' ? '已中断' : '失败'}</span>
          </div>
          <div className='muted' style={{ marginTop: 4 }}>
            完成 {job.completed}/{job.total}，成功 {job.succeeded}，失败 {job.failed}，待处理 {job.pending}
            {job.currentName ? '；当前：' + job.currentName : ''}
          </div>
          {job.message && <details className='import-report-details'><summary>查看导入报告与失败原因</summary><p>{job.message}</p></details>}
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
          <div className='card' id='cfg-import' style={{ padding: 20, marginBottom: 20 }}>
            <div className='import-heading'><h3>导入订阅</h3><p>支持单仓、多仓和直播配置，多仓会自动分组保存。</p></div>
            <div className='import-fields'>
              <label>名称（可选）<input
                placeholder='自动读取订阅名称'
                value={flow.name}
                onChange={(event) => flow.setName(event.target.value)}
              /></label>
              <label>配置地址<input
                aria-label='配置地址'
                placeholder='https://…'
                value={flow.url}
                onChange={(event) => flow.setUrl(event.target.value)}
              /></label>
            </div>
            <div className='import-actions'>
              <button
                className='primary'
                disabled={busy || importRunning || !flow.url.trim()}
                onClick={() => void flow.importUrl()}
                title='多仓地址会建立订阅组，每个子仓单独保存为配置档案。超大清单分批处理，完成后可继续待处理项。地址尾加 #line=N 可单独导入一条线路。'
              >
                {busy ? '导入中…' : '导入订阅'}
              </button>
              <span className='muted'>可查看进度、取消或重试失败项。</span>
            </div>
            <details className='import-other'><summary>从本地文件导入</summary><div className='row'>
              <button disabled={busy || importRunning} onClick={() => void flow.importJsonLocal()}>JSON 文件</button>
              <button disabled={busy || importRunning} onClick={() => void flow.importPyLocal()}>Python 文件</button>
              <button disabled={busy || importRunning} onClick={() => void flow.importPackage()} title='可选择仅含 .py 文件的文件夹，自动在应用副本中生成订阅 JSON'>导入本地包</button>
              <button disabled={busy || importRunning} onClick={() => void flow.importLiveLocal()} title='选择本地 .txt / .m3u / .m3u8 直播源文件；导入后到「直播」页顶部线路下拉切换'>导入直播源（TXT / M3U）</button>
            </div></details>
            {notice && <output className='status' style={{ display: 'block', marginTop: 12 }}>{notice}</output>}
            {error && <div className='err' role='alert' style={{ marginBottom: 8 }}>操作失败：{error}</div>}
            {flow.warnings.length > 0 && <div className='banner'>{flow.warnings.join('；')}</div>}
            {flow.report && (
              <div className='status'>
                最近一次导入：{flow.report.total} 条 · 成功 {flow.report.ok} · 跳过 {flow.report.skipped} · 降级 {flow.report.degraded}
              </div>
            )}
          </div>

          {flow.report && flow.report.items.length > 0 && (
            <details className='import-diagnostics' style={{ marginBottom: 16 }}>
              <summary>最近一次导入诊断（{flow.report.items.length} 条）</summary>
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scroll region needs focus for keyboard scrolling. */}
              <section className='table-scroll' aria-label='导入诊断' tabIndex={0}>
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
                          ? <span style={{ color: 'var(--text-success)' }}>可用</span>
                          : <span style={{ color: 'var(--text-warn)' }} title={item.message}>{item.message}</span>}
                      </td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.api}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </section>
            </details>
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
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void flow.confirmPackageName(); }}
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
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void flow.confirmLiveName(); }}
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
