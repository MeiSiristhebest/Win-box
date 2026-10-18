import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const exe = process.platform === 'win32' ? '.exe' : '';
const javac = join(bin, 'javac' + exe);
const java = resolve('resources/jvm/jre/bin/java' + exe);

describe.skipIf(!bin || !existsSync(javac) || !existsSync(java))('桌面 JVM ScrollView 桩', () => {
  it('可加载、构造并执行配置页常用方法', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-scroll-view-'));
    try {
      const source = join(dir, 'ScrollViewProbe.java');
      writeFileSync(source, [
        'import android.content.Context;',
        'import android.widget.ScrollView;',
        'public class ScrollViewProbe {',
        '  public ScrollView configView;',
        '  public static void main(String[] args) throws Exception {',
        '    if (ScrollViewProbe.class.getDeclaredField("configView").getType() != ScrollView.class) throw new RuntimeException("field type");',
        '    ScrollView view = new ScrollView((Context) null);',
        '    new ScrollView((Context) null, null);',
        '    new ScrollView((Context) null, null, 0);',
        '    if (view.isFillViewport() || !view.isSmoothScrollingEnabled()) throw new RuntimeException("defaults");',
        '    view.setFillViewport(true);',
        '    view.setSmoothScrollingEnabled(false);',
        '    view.addView(new android.widget.LinearLayout((Context) null));',
        '    view.smoothScrollTo(0, 100);',
        '    if (!view.isFillViewport() || view.isSmoothScrollingEnabled()) throw new RuntimeException("state");',
        '    System.out.print("scroll-view-ok");',
        '  }',
        '}',
      ].join('\n'), { encoding: 'utf8' });
      const cp = resolve('resources/jvm/stubs/stubs.jar');
      const compile = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', cp, '-d', dir, source], { encoding: 'utf8', timeout: 30000 });
      expect(compile.status, compile.stderr).toBe(0);
      const run = spawnSync(java, ['-cp', [dir, cp].join(delimiter), 'ScrollViewProbe'], { encoding: 'utf8', timeout: 10000 });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('scroll-view-ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
