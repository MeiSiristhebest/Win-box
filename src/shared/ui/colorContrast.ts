type Rgba = readonly [red: number, green: number, blue: number, alpha: number];
type Rgb = readonly [red: number, green: number, blue: number];

function parseNumber(value: string, scale: number): number | null {
  const trimmed = value.trim();
  const percent = trimmed.endsWith('%');
  const number = Number(percent ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(scale, percent ? number * scale / 100 : number));
}

function parseAlpha(value: string | undefined): number | null {
  if (value == null) return 1;
  const trimmed = value.trim();
  const percent = trimmed.endsWith('%');
  const number = Number(percent ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, percent ? number / 100 : number));
}

function parseHex(value: string): Rgba | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null;
  if (hex.length === 3 || hex.length === 4) {
    const channels = [...hex].map((channel) => Number.parseInt(channel + channel, 16));
    return [channels[0], channels[1], channels[2], channels[3] == null ? 1 : channels[3] / 255];
  }
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  ];
}

function parseFunctionalColor(value: string): Rgba | null {
  const match = /^(rgba?|hsla?)\(\s*([^)]*)\)$/i.exec(value.trim());
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const body = match[2].trim();
  const commaParts = body.includes(',') ? body.split(',').map((part) => part.trim()) : null;
  const slashParts = commaParts ? null : body.split('/').map((part) => part.trim());
  const channels = commaParts
    ? commaParts.slice(0, 3)
    : (slashParts?.[0] || '').split(/\s+/).filter(Boolean);
  const alphaText = commaParts?.[3] ?? slashParts?.[1];
  if (channels.length !== 3) return null;
  const alpha = parseAlpha(alphaText);
  if (alpha == null) return null;

  if (kind.startsWith('rgb')) {
    const parseChannel = (channel: string): number | null => {
      const percent = channel.endsWith('%');
      const number = parseNumber(channel, percent ? 100 : 255);
      return number == null ? null : percent ? number * 2.55 : number;
    };
    const red = parseChannel(channels[0]);
    const green = parseChannel(channels[1]);
    const blue = parseChannel(channels[2]);
    if (red == null || green == null || blue == null) return null;
    return [red, green, blue, alpha];
  }

  const hueText = channels[0].replace(/deg$/i, '');
  const hueValue = Number(hueText);
  const saturation = channels[1].endsWith('%') ? Number(channels[1].slice(0, -1)) / 100 : NaN;
  const lightness = channels[2].endsWith('%') ? Number(channels[2].slice(0, -1)) / 100 : NaN;
  if (!Number.isFinite(hueValue) || !Number.isFinite(saturation) || !Number.isFinite(lightness)) return null;
  const h = ((hueValue % 360) + 360) % 360 / 360;
  const s = Math.max(0, Math.min(1, saturation));
  const l = Math.max(0, Math.min(1, lightness));
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - chroma / 2;
  const sector = Math.floor(h * 6);
  const [r, g, b] = sector === 0 ? [chroma, x, 0]
    : sector === 1 ? [x, chroma, 0]
      : sector === 2 ? [0, chroma, x]
        : sector === 3 ? [0, x, chroma]
          : sector === 4 ? [x, 0, chroma]
            : [chroma, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255, alpha];
}

function parseColor(value: string): Rgba | null {
  return value.trim().startsWith('#') ? parseHex(value) : parseFunctionalColor(value);
}

function composite(foreground: Rgba, background: Rgb): Rgb {
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
  ];
}

function luminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * WCAG relative-luminance contrast for CSS sRGB colors. Alpha colors are
 * composited over the supplied backdrop (or the opaque background) before
 * contrast is measured. Unsupported values return null rather than passing.
 */
export function wcagContrastRatio(foreground: string, background: string, backdrop?: string): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const canvas = backdrop ? parseColor(backdrop) : null;
  if (!fg || !bg || (backdrop && !canvas)) return null;

  const opaqueCanvas: Rgb = canvas
    ? composite(canvas, [0, 0, 0])
    : [0, 0, 0];
  const opaqueBackground = bg[3] === 1
    ? [bg[0], bg[1], bg[2]] as Rgb
    : composite(bg, opaqueCanvas);
  const opaqueForeground = composite(fg, opaqueBackground);
  const fgLuminance = luminance(opaqueForeground);
  const bgLuminance = luminance(opaqueBackground);
  return (Math.max(fgLuminance, bgLuminance) + 0.05) / (Math.min(fgLuminance, bgLuminance) + 0.05);
}
