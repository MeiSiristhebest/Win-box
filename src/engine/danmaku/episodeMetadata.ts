/** 中文数字（一~十/十一…）→ 数字；非汉字数字直接 Number */
function chineseNumber(value: string): number | undefined {
  const text = (value || '').trim();
  if (/^\d{1,2}$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (digits[text] != null) return digits[text];
  const teens = /^十([一二三四五六七八九])$/.exec(text);
  if (teens) return 10 + digits[teens[1]];
  const tens = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(text);
  if (tens) return digits[tens[1]] * 10 + (tens[2] ? digits[tens[2]] : 0);
  return undefined;
}

/**
 * 从资源名、剧名或集名里提取季号。
 * 支持「第一季」「第2季」「Breaking.Bad.S01E01」「Season 2」等常见写法。
 */
export function seasonOf(name: string): number | undefined {
  const text = name || '';
  const chineseSeason = /第\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*季/.exec(text);
  if (chineseSeason) {
    const season = chineseNumber(chineseSeason[1]);
    if (season && season >= 1 && season <= 99) return season;
  }
  const latinSeason = /(?:^|[^a-z0-9])s(?:eason)?\s*0?(\d{1,2})(?![0-9])/i.exec(text);
  if (latinSeason) {
    const season = Number(latinSeason[1]);
    if (season >= 1 && season <= 99) return season;
  }
  return undefined;
}
