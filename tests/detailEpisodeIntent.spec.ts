import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

type AstNode = { type: string; start: number | null; end: number | null; [key: string]: unknown };
const source = readFileSync(new URL('../src/renderer/pages/DetailPage.tsx', import.meta.url), 'utf8');
const file = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
const playbackSource = readFileSync(new URL('../src/renderer/features/detail/useDetailPlaybackController.ts', import.meta.url), 'utf8');
const playbackFile = parse(playbackSource, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
const playbackUseCaseSource = readFileSync(new URL('../src/renderer/features/detail/application/detailPlaybackUseCase.ts', import.meta.url), 'utf8');
const playbackAdapterSource = readFileSync(new URL('../src/renderer/features/detail/adapters/detailPlaybackAdapter.ts', import.meta.url), 'utf8');
const playerSessionSource = readFileSync(new URL('../src/renderer/features/playback/usePlayerPageSession.ts', import.meta.url), 'utf8');
const playerResolutionUseCaseSource = readFileSync(new URL('../src/renderer/features/playback/application/resolvePlayerPageEpisode.ts', import.meta.url), 'utf8');
const playerSessionWorkflowSource = readFileSync(new URL('../src/renderer/features/playback/application/playerPageSessionWorkflow.ts', import.meta.url), 'utf8');
const playerSessionAdapterSource = readFileSync(new URL('../src/renderer/features/playback/adapters/playerPageSessionAdapter.ts', import.meta.url), 'utf8');
const episodeListSource = readFileSync(new URL('../src/renderer/features/detail/DetailEpisodeList.tsx', import.meta.url), 'utf8');

function walk(value: unknown, visit: (node: AstNode) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, visit);
    return;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type === 'string') visit(candidate as AstNode);
  for (const [key, child] of Object.entries(candidate)) {
    if (key !== 'loc' && key !== 'start' && key !== 'end' && key !== 'extra' && key !== 'tokens' && key !== 'comments') {
      walk(child, visit);
    }
  }
}

function textOf(node: AstNode, code: string): string {
  if (node.start === null || node.end === null) throw new Error('AST node has no source range');
  return code.slice(node.start, node.end);
}

function findFunction(name: string, ast: unknown = file): AstNode {
  let found: AstNode | undefined;
  walk(ast, (node) => {
    const id = node.id as AstNode | undefined;
    if (node.type === 'FunctionDeclaration' && id?.name === name) found = node;
  });
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}

function callsOnClient(code: string): string[] {
  const ast = parse(code, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
  const calls: string[] = [];
  walk(ast, (node) => {
    const callee = node.callee as AstNode | undefined;
    const object = callee?.object as AstNode | undefined;
    const property = callee?.property as AstNode | undefined;
    if (node.type === 'CallExpression' && callee?.type === 'MemberExpression' && object?.name === 'client' && typeof property?.name === 'string') {
      calls.push(property.name);
    }
  });
  return calls;
}

describe('detail episode playback intent', () => {
  it('取链失败不会把原始选集参数回退交给播放器，preparedUrl 也经过校验', () => {
    const play = textOf(findFunction('play', playbackFile), playbackSource);
    expect(playbackUseCaseSource).toContain('playbackResultError(result)');
    expect(play).toContain('resolveDetailEpisodePlayback(');
    expect(play).toContain('onPlay(outcome.url,');
    expect(play).not.toContain('result.url || target.url');
    expect(playerResolutionUseCaseSource).toContain('playbackResultError(result)');
    expect(playerResolutionUseCaseSource).toContain('recordOpenedPlayerEpisode(');
    expect(playerSessionWorkflowSource).toContain('resolvePlayerPageEpisode(');
    expect(playerSessionSource).toContain('createPlayerPageSessionWorkflow(');
    expect(playerSessionSource).not.toContain('resolvePlayerPageEpisode(');
    expect(playerSessionSource).not.toContain('playbackResultError(result)');
    expect(playerSessionSource).not.toContain('setActiveUrl(target.url)');
  });

  it('封面与背景加载不进入播放链路，简介仍展示源数据', () => {
    for (const content of [source, playbackSource, playerSessionSource]) {
      const calls = callsOnClient(content);
      expect(calls).not.toContain('metaSearch');
      expect(calls).not.toContain('metaExtra');
      expect(calls).not.toContain('metaImages');
    }
    expect(callsOnClient(playerSessionSource)).not.toContain('play');
    expect(callsOnClient(playerSessionAdapterSource)).toContain('play');
    expect(callsOnClient(playbackSource)).not.toContain('play');
    expect(callsOnClient(playbackAdapterSource)).toContain('play');
    expect(textOf(findFunction('play', playbackFile), playbackSource)).not.toMatch(/useCovers|metaSearch|metaDiscoverImages/);
    expect(source).toContain("pic: detail?.pic || fromListPic || ''");
    expect(source).toContain("const introText = (detail?.des || '').trim()");
  });

  it('single-click updates selection without switching or opening a player', () => {
    const choose = textOf(findFunction('chooseEp', playbackFile), playbackSource);
    expect(choose).toContain('setEp(index)');
    expect(choose).not.toMatch(/playerSwitchEp|playerIsOpen|onPlay\(|client\.play\(/);
  });

  it('double-click submits the clicked global index, not the asynchronous selection state', () => {
    expect(episodeListSource).toContain('onDoubleClick={() => onPlayEpisode(globalIndex)}');
    expect(source).toContain('onPlayEpisode={(index) => { void play(index); }}');
    const play = findFunction('play', playbackFile);
    const parameters = play.params as AstNode[];
    const first = parameters[0];
    const body = play.body as AstNode;
    const parameter = first.type === 'AssignmentPattern' ? first.left as AstNode : first;
    expect(parameter.name).toBe('index');
    const fallback = first.type === 'AssignmentPattern' ? first.right as AstNode : undefined;
    expect(fallback ? textOf(fallback, playbackSource) : undefined).toBe('ep');
    expect(textOf(body, playbackSource)).toContain('const target = episodes[index]');
    expect(textOf(body, playbackSource)).toContain('epIndex: index');
    expect(textOf(body, playbackSource)).not.toMatch(/episodes\[ep\]|epIndex:\s*ep\b/);
  });

  it('the play button calls play rather than passing the MouseEvent as an episode index', () => {
    expect(source).not.toContain('onClick={play}');
    expect(source).toContain('onClick={() => { void play(); }}');
  });

  it('main-window playback handoff carries the complete episode context', () => {
    const app = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('client.playerSwitchEp({');
    expect(app).toMatch(/key:\s*fromKey/);
    expect(app).toMatch(/vodId:\s*meta\?\.vodId\s*\|\|\s*id/);
    expect(app).toMatch(/flag:\s*meta\?\.flag\s*\|\|\s*''/);
    expect(app).toContain('episodes: eps');
    expect(app).toContain('epIndex: idx');
  });

  it('player-local previous/next switching updates init.epIndex before resolving', () => {
    expect(playerSessionWorkflowSource).toContain('const next = { ...current, startTime: 0, lastUrl: \'\', epIndex: index };');
    expect(playerSessionWorkflowSource).toContain('updateInit(next);');
    expect(playerSessionWorkflowSource).toContain('void resolveWithRecovery(next, index);');
    expect(playerSessionWorkflowSource).toContain('index >= current.episodes.length');
    expect(playerSessionWorkflowSource).toContain('!Number.isInteger(index)');
  });
});
