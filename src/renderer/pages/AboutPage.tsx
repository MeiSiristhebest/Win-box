// src/renderer/pages/AboutPage.tsx
// About page with project information and the usage disclaimer.
import { MODIFIED_BUILD_DISCLAIMER } from '../lib/disclaimerText';

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
          <h3>一、软件性质</h3>
          <p>
            Win-Box 是开源学习项目，提供通用影片播放工具（播放器外壳）。软件不提供内容服务，不存储或推送影视资源与内容。
          </p>
        </section>

        <section className="about-sec">
          <h3>二、不提供、不存储、不分发内容</h3>
          <p>
            软件不内置影视资源索引，也不运营内容服务器。你自行配置或导入的播放源、直播源、弹幕与字幕接口、网盘凭据和内容来自第三方，与本软件及作者无关。
          </p>
          <p>
            软件内的本地代理（<span className="muted">127.0.0.1</span>）仅用于把你设备上的播放请求转发给第三方，不构成对内容的托管、缓存或再分发。
          </p>
        </section>

        <section className="about-sec">
          <h3>三、与第三方无隶属关系</h3>
          <p>
            本软件与任何影视平台、内容站点、网盘服务、TVBox / CatVod 及其发行方均无隶属、合作、代理或授权关系。相关名称与商标归各自权利人所有，仅用于客观描述兼容性。
          </p>
        </section>

        <section className="about-sec">
          <h3>四、使用者责任</h3>
          <p>
            请确保自行导入的第三方来源和使用行为符合所在地法律法规，不得用于传播或观看违法、侵权内容。因使用第三方来源引发的一切后果（包括版权、侵权和内容合法性问题）由用户与第三方自行承担，作者免责。不同意这些约定时，请停止使用并删除本软件。
          </p>
        </section>

        <section className="about-sec">
          <h3>五、知识产权与权利通知</h3>
          <p>
            本软件仅提供播放工具，不对第三方内容主张权利，也未从第三方内容中获利。权利人如认为本项目的某项行为可能侵权，可通过下方 GitHub 主页的 Issues 联系维护者；维护者会核实并配合处理，包括移除相关内容或停止分发。
          </p>
        </section>

        <section className="about-sec">
          <h3>六、无担保声明</h3>
          <p>
            本软件按“现状”提供，不附带任何明示或默示担保，包括可用性、适用性与不侵权保证。作者不对使用或无法使用本软件造成的直接或间接损失负责。
          </p>
        </section>

        <section className="about-sec">
          <h3>七、二次修改与再分发</h3>
          <p>
            <b>{MODIFIED_BUILD_DISCLAIMER}</b>
          </p>
        </section>

        <section className="about-sec">
          <h3>八、播放源</h3>
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
