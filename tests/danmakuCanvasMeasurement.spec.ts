import { describe, expect, it } from 'vitest';
import { createCanvasTextMeasurement } from '../src/renderer/components/danmakuCanvasMeasurement';

function makeMeasurementCanvas(widthPerCharacter: number) {
  const canvas = { width: 320, height: 64 };
  const context = {
    canvas,
    font: '',
    measureText: (text: string) => ({ width: text.length * widthPerCharacter }),
  } as unknown as CanvasRenderingContext2D;
  return {
    canvas,
    element: { getContext: () => context } as unknown as HTMLCanvasElement,
  };
}

describe('overlay-scoped canvas text measurement', () => {
  it('keeps separate overlay metrics and cache disposal isolated', () => {
    const narrowCanvas = makeMeasurementCanvas(8);
    const wideCanvas = makeMeasurementCanvas(24);
    let narrowCreates = 0;
    const narrow = createCanvasTextMeasurement(() => {
      narrowCreates++;
      return narrowCanvas.element;
    });
    const wide = createCanvasTextMeasurement(() => wideCanvas.element);

    expect(narrow.measure('danmaku', 24)).toBe(56);
    expect(wide.measure('danmaku', 24)).toBe(168);
    expect(narrow.measure('danmaku', 24)).toBe(56);

    narrow.dispose();
    expect(narrowCanvas.canvas).toMatchObject({ width: 0, height: 0 });
    expect(wideCanvas.canvas).toMatchObject({ width: 320, height: 64 });
    expect(wide.measure('danmaku', 24)).toBe(168);
    expect(narrow.measure('danmaku', 24)).toBe(56);
    expect(narrowCreates).toBe(2);

    narrow.dispose();
    wide.dispose();
  });
});
