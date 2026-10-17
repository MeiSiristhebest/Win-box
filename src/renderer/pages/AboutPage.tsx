// src/renderer/pages/AboutPage.tsx
// About page with the app's features, source repository, and license.

/** 项目主页（源码 / 更新发布） */
const GITHUB_URL = 'https://github.com/MeiSiristhebest/Win-box';

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function AboutPage() {
  return (
    <>
      <div className="topbar" style={{ justifyContent: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>关于 Win-Box</h2>
      </div>
      <div className="content about">
        <section className="about-sec">
          <h3>功能</h3>
          <p>
            Win-Box 是 Windows 桌面媒体源管理与播放工具。你可以导入多份配置、分别管理播放源，并合并导出配置。
          </p>
        </section>

        <section className="about-sec">
          <h3>播放源</h3>
          <p>
            Win-Box 不提供播放源或媒体内容。请确认你有权使用自行导入的来源和内容。
          </p>
        </section>

        <section className="about-sec">
          <h3>源代码与问题反馈</h3>
          <p>
            查看源代码、提交问题或查看版本更新：
          </p>
          <div className="about-links">
            <button className="about-link" onClick={() => openExternal(GITHUB_URL)} title={GITHUB_URL}>
              <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span>项目主页</span>
            </button>
          </div>
        </section>

        <section className="about-sec">
          <h3>许可证</h3>
          <p>
            项目代码采用 MIT 许可证，详见仓库中的 LICENSE 文件。第三方组件按各自许可证使用。
          </p>
        </section>
      </div>
    </>
  );
}
