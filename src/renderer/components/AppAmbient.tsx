// src/renderer/components/AppAmbient.tsx
// ★ 2026-10-16（用户要求「四套皮肤绝对大改」）：**环境光背景场** —— 全站底层氛围层。
//   四套外壳共用同一份 DOM（三个缓慢漂移的光斑 + 一张噪点纹理），只有配色与强度由各皮肤 CSS 决定：
//     netflix = 影院暖黑 + 品牌红余光；哔哔 = 蓝粉双色柔光；大果 = 苹果蓝紫玻璃光；大豆 = 豆绿橙暖光。
//   为什么单独做一层而不是给 body 加背景：页面内容区（.content）自身要滚动，
//   只有把氛围层**固定在视口**上、并让外壳各级背景透明，氛围才不会随内容滚走（影院幕布感）。
//   纯装饰：pointer-events:none、aria-hidden，不参与命中测试与无障碍树。
export default function AppAmbient() {
  return (
    <div className="app-ambient" aria-hidden="true">
      <span className="amb-blob amb-blob-1" />
      <span className="amb-blob amb-blob-2" />
      <span className="amb-blob amb-blob-3" />
      <span className="amb-grain" />
    </div>
  );
}
