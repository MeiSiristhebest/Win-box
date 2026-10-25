import { parseDriveDescriptor, descriptorField } from './driveDescriptor';

/** 判断某播放 id 是否夸克分享（episode JSON 含 sId 或直达 pan.quark.cn/s/） */
export function isQuarkSharePlay(id: string, flag = ''): boolean {
  return !!extractQuarkShare(id, flag);
}

/**
 * ★ 2026-10-09（第三方修复文档参考 + 本仓实证）：从文本（jar 的 `do=pan` 代理地址等）提取
 * **夸克分享 sId 与提取码**（`pan.quark.cn/s/<id>`）。与 baiduTransfer / ucTransfer 同款：
 * 原文 + ≤2 轮 percent-decode（jar 会把分享 URL percent-encode 塞进 fileId）。
 * 提取码两种形态：`?pwd=/password=/passcode=`（4 位）或文本「提取码：xxxx / 密码：xxxx」。
 * 背景：do=pan 的原生解链此前只有百度 / UC 两条通道，`site=quark` 的线路必然「双未识别」；
 * 且 `quarkTransferInner` 的 share/token 请求此前 passcode 恒空串 → **带码分享必失败**。
 */
export function extractQuarkShare(text: string, flag = ''): { sId: string; passcode: string } | null {
  const compound = extractCompoundPanEpisode(text);
  if (compound && /^(?:quark|夸克)/i.test(flag)) return { sId: compound.shareId, passcode: '' };
  // ★ 2026-10-14：`quark@<base64(JSON)>` 描述符（盘搜/免转存家族）→ 直接取 shareId(=pwd_id)。
  //   走既有 quarkTransfer 免转存通道（不再把 id 原样丢给蜘蛛而必报「未登录」）。
  {
    const desc = parseDriveDescriptor(text);
    if (desc && desc.provider === 'quark') {
      const sId = descriptorField(desc.data, 'shareId', 'pwdId', 'sId');
      if (sId) return { sId, passcode: String(desc.data.passcode || '') };
    }
  }
  try {
    const obj = JSON.parse(text);
    // sId 是 UC/夸克共用字段；已明确其他提供商时不能仅凭 sId 误走夸克。
    const provider = String(obj?.site || obj?.provider || obj?.flag || flag);
    const otherDrive = /^(?:uc(?:\b|无限)|优汐|baidu|百度)/i.test(provider) || /(?:drive|fast)\.uc\.cn\/s\//i.test(text);
    if (!otherDrive && typeof obj?.sId === 'string' && /^[a-z0-9]+$/i.test(obj.sId)) return { sId: obj.sId, passcode: String(obj.passcode || obj.pwd || '') };
  } catch { /* URL/text */ }
  let cur = String(text || '');
  for (let i = 0; i < 3 && cur; i++) {
    const m = /pan\.quark\.cn\/s\/([0-9a-zA-Z]+)/i.exec(cur);
    if (m) {
      const p =
        /[?&#](?:pwd|password|passcode)=([0-9a-zA-Z]{4})/i.exec(cur) ||
        /(?:提取码|密码|passcode|pwd)\s*[:：]\s*([0-9a-zA-Z]{4})/i.exec(cur);
      return { sId: m[1], passcode: p ? p[1] : '' };
    }
    let next = '';
    try {
      next = decodeURIComponent(cur);
    } catch {
      break; // 非法百分号序列：不再往下解
    }
    if (next === cur) break;
    cur = next;
  }
  return null;
}

/**
 * ★ 从 episode id（夸克分享 JSON 或直达链接）提取「内层文件 fid」。
 * 玩偶/立播等源的 episode JSON 字段不统一（fid / vfid / file_id / fids 数组 / URL ?fid= 参数），
 * 只认 `"fid"` 会把字段名不同的传成 undefined → 转存落到「目录第一个文件」= 播第6集落第29集。
 * 按常见字段名逐一尝试；取不到返回 ''，多文件分享必须拒绝盲选。
 */
/** 潇洒玩偶的选集协议：名称__分享内 fid+分享 ID+文件 token（只接受已观察到的完整格式）。 */
export function extractCompoundPanEpisode(id: string): { name: string; fid: string; shareId: string } | null {
  const m = /^(.*?)__([0-9a-f]{32})\+([0-9a-z]{10,32})\+([0-9a-f]{32})$/i.exec(String(id || ''));
  return m?.[1] ? { name: m[1], fid: m[2], shareId: m[3] } : null;
}

export function extractEpisodeFid(id: string): string {
  if (!id) return '';
  // ★ 2026-10-14：`<prov>@<base64(JSON)>` 描述符 → 直接取 fileId（免转存要按 fid 精确命中文件）
  {
    const desc = parseDriveDescriptor(id);
    if (desc) {
      const f = descriptorField(desc.data, 'fileId', 'fid', 'fs_id', 'file_id');
      if (f) return f;
    }
  }
  const compound = extractCompoundPanEpisode(id);
  if (compound) return compound.fid;
  // JSON：fid / vfid / file_id（字符串或数组首元素）
  const pats = [
    /"fid"\s*:\s*"([^"]+)"/,
    /"vfid"\s*:\s*"([^"]+)"/,
    /"file_id"\s*:\s*"([^"]+)"/,
    /"fileId"\s*:\s*"([^"]+)"/,
    /"fs_id"\s*:\s*"?(\d+)"?/,
    /"fid"\s*:\s*\[?\s*"([^"]+)"/,
    /"fids"\s*:\s*\[\s*"([^"]+)"/,
  ];
  for (const re of pats) {
    const m = re.exec(id);
    if (m?.[1] && !/[/:?]/.test(m[1])) return m[1];
  }
  // 直达链接 query（pan.quark.cn/s/xxx?fid=…&更多 或 #/ 内嵌页；取值到 & 或 # 为止）
  const q = /[?&](?:fid|vfid|file_id)=([^&#"'\\\s]+)/i.exec(id);
  if (q?.[1]) {
    try { return decodeURIComponent(q[1]); } catch { return q[1]; }
  }
  return '';
}

/**
 * ★ 2026-09-29：从 episode id 提取**集名**（`name`/`file_name`/`fileName`/`title`）。
 *   用于 fid 在分享内匹配不到时的「按集名唯一匹配」兜底（见 resolveShareFile 第 ④ 条）。
 */
export function extractEpisodeName(id: string): string {
  if (!id) return '';
  const compound = extractCompoundPanEpisode(id);
  if (compound) return compound.name;
  // ★ 2026-10-14：描述符（`<prov>@<b64>` 与嵌套信封）里的 name（内层 e / 外层 d 已归一）优先
  {
    const desc = parseDriveDescriptor(id);
    const n = desc ? String(desc.data.name || '').trim() : '';
    if (n) return n;
  }
  // 值里可能含转义引号（JSON 字符串）→ 用 `(?:[^"\\]|\\.)` 逐字符匹配
  const V = '((?:[^"\\\\]|\\\\.){1,120})';
  const pats = [
    new RegExp(`"name"\\s*:\\s*"${V}"`),
    new RegExp(`"file_name"\\s*:\\s*"${V}"`),
    new RegExp(`"fileName"\\s*:\\s*"${V}"`),
    new RegExp(`"title"\\s*:\\s*"${V}"`),
  ];
  for (const re of pats) {
    const m = re.exec(id);
    if (m?.[1]) {
      try {
        return JSON.parse(`"${m[1]}"`) as string; // 反转义
      } catch {
        return m[1];
      }
    }
  }
  return '';
}

/**
 * ★ 2026-09-29：集名归一（用于夸克转存的「按集名唯一匹配」兜底）。
 *   优先集号：`S01E06` / `第6集` / `E06` / `06.mp4` → `ep6`；提不到集号 → 去扩展名的文件名。
 *   纯函数、可单测；集号相同才算同一集（避免「同名不同集」误判）。
 */
export function episodeKeyOf(name: string): string {
  // 先剥离源附加的大小和媒体扩展名，避免把 mp4 中的 4 当作集号。
  const s = String(name || '').trim()
    .replace(/\[\s*\d+(?:\.\d+)?\s*(?:[KMGT]i?B)\s*\]$/i, '')
    .replace(/\.(?:mp4|mkv|avi|mov|m4v|ts|m2ts|flv|wmv|webm|m3u8)\s*$/i, '').trim();
  if (!s) return '';
  const se = /[Ss]\d{1,2}\s*[Ee]\s*0*(\d{1,4})/.exec(s);
  if (se) return `ep${Number(se[1])}`;
  const cn = /第\s*0*(\d{1,4})\s*[集话期]/.exec(s);
  if (cn) return `ep${Number(cn[1])}`;
  const e = /(?:^|[^a-z0-9])[Ee][Pp]?\s*0*(\d{1,4})(?![0-9])/i.exec(s);
  if (e) return `ep${Number(e[1])}`;
  // 真实 UC 文件名：03~4K(1).mp4、[剧名]03-4K.mp4[1.63GB]。
  // 集号必须位于开头或分隔符之后、画质标记之前，不能取 4K/1080p 的数字。
  const quality = /(?:^|[\]\s._-])0*(\d{1,3})[\s.~_-]+(?:4k|2k|2160p|1080p|720p)(?![a-z0-9])/i.exec(s);
  if (quality) return `ep${Number(quality[1])}`;
  // 结尾裸集号（`06.mp4` / `斗罗大陆 120`）
  const bare = /(?:^|[^a-z0-9])0*(\d{1,3})(?=\.[a-z0-9]{1,5}$|\s*$)/i.exec(s);
  if (bare) return `ep${Number(bare[1])}`;
  return s.replace(/\.[a-z0-9]{1,6}$/i, '').trim();
}
