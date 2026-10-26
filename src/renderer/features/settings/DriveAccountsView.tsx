export function DriveAccountsView({ onManage }: { onManage(): void }) {
  return (
    <div className="card" id="cfg-drives" style={{ padding: 12, marginBottom: 16 }}>
      <h2>全局网盘账号</h2>
      <p>登录状态独立保存在本机，跨子仓和站点共享。可在这里统一登录、更新或解绑。</p>
      <button type="button" onClick={onManage}>管理网盘登录状态</button>
    </div>
  );
}
