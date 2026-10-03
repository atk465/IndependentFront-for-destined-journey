/**
 * card-craft-narrate.test.ts — 制卡叙事与命名：意图派生兜底名 / 输出解析
 */
import { describe, it, expect } from 'vitest';
import {
  deriveFallbackProductName,
  parseCraftNarration,
  buildCraftNarrateMessages,
  fallbackCraftNarration,
} from './card-craft-narrate';

describe('deriveFallbackProductName（意图 → 兜底卡名）', () => {
  it('短意图剥掉量词壳直接当名字（真机案例：写钓竿产出钓竿，不是主素材·卡）', () => {
    expect(deriveFallbackProductName('一根钓竿')).toBe('钓竿');
    expect(deriveFallbackProductName('钓竿')).toBe('钓竿');
    expect(deriveFallbackProductName('我想做一张护心镜')).toBe('护心镜');
    expect(deriveFallbackProductName('帮我弄个火折子')).toBe('火折子');
  });

  it('第一子句优先；后续子句不参选', () => {
    expect(deriveFallbackProductName('钓竿，能收能放的那种')).toBe('钓竿');
  });

  it('长句/含糊话返回 undefined（调用方回落主素材·卡）', () => {
    expect(deriveFallbackProductName('能钓上深渊之物的绝世好竿')).toBeUndefined();
    expect(deriveFallbackProductName('随便做做看')).toBeUndefined();
    expect(deriveFallbackProductName('')).toBeUndefined();
    expect(deriveFallbackProductName(undefined)).toBeUndefined();
    expect(deriveFallbackProductName('   ')).toBeUndefined();
  });

  it('清洗后为空的子句跳过（纯引导词开头）', () => {
    expect(deriveFallbackProductName('做！钓竿')).toBe('钓竿');
  });
});

describe('parseCraftNarration', () => {
  it('按 <name>/<narrative> 解析；名字剥引号', () => {
    const r = parseCraftNarration('<name>「青枝钓竿」</name>\n<narrative>他捏着枝条……</narrative>');
    expect(r.name).toBe('青枝钓竿');
    expect(r.narrative).toBe('他捏着枝条……');
  });

  it('<desc> 解析为卡面描述；缺 desc 时 description 留空（保留意图原文）', () => {
    const r = parseCraftNarration(
      '<name>青枝钓竿</name>\n<desc>枝条拧成的钓竿，竿梢一点星芒。</desc>\n<narrative>他捏着枝条……</narrative>',
    );
    expect(r.description).toBe('枝条拧成的钓竿，竿梢一点星芒。');
    const noDesc = parseCraftNarration('<name>X</name>\n<narrative>叙述</narrative>');
    expect(noDesc.description).toBeUndefined();
  });

  it('🔴 叙事段截断（</narrative> 未闭合）：已成形的 <name>/<desc> 不再被丢（CRAFT-2）', () => {
    // 2026-10-02 真机：AI 三块齐全但流式截断 → 名字落到兜底「地脉髓·卡」
    const raw =
      '<name>残偶怒俑</name>\n<desc>白发瓷偶般的少女蜷于地脉余烬之中。</desc>\n<narrative>她睁开猩红的独眼，';
    const r = parseCraftNarration(raw);
    expect(r.name).toBe('残偶怒俑');
    expect(r.description).toBe('白发瓷偶般的少女蜷于地脉余烬之中。');
    expect(r.narrative).toContain('猩红的独眼');
    expect(r.narrative).not.toContain('<name>');
  });

  it('只有 <name> 成形（连 <narrative> 开标签都没有）：名字仍保留', () => {
    const r = parseCraftNarration('<name>残偶怒俑</name>\n后面是没包标签的自由发挥');
    expect(r.name).toBe('残偶怒俑');
    expect(r.narrative).not.toContain('<name>');
  });

  it('没按格式来 → 整段当叙事，名字留空（调用方兜底）', () => {
    const r = parseCraftNarration('AI 没守格式的自由发挥');
    expect(r.name).toBeUndefined();
    expect(r.narrative).toContain('自由发挥');
  });
});

describe('buildCraftNarrateMessages', () => {
  it('意图空缺时有占位口径；定案数字原样进入 user 消息', () => {
    const msgs = buildCraftNarrateMessages({
      provisionalName: '世界树嫩芽·卡',
      tier: '星辉',
      entries: ['生机'],
      cost: 90,
      rating: '成功',
      fusionKind: '叠加',
      materials: ['世界树嫩芽', '传说铁'],
      consumed: ['世界树嫩芽', '传说铁'],
      intent: '  ',
    });
    expect(msgs[1].content).toContain('（他没有说，只凭手感）');
    expect(msgs[1].content).toContain('世界树嫩芽');
    expect(msgs[0].content).toContain('不得引入或更改任何数字');
  });
});

describe('fallbackCraftNarration', () => {
  it('失败/成功两种口径', () => {
    const plan = {
      rating: '失败',
      product: { name: 'x', cardTier: '黑铁', 词条: [], recipe: { fusionKind: '叠加', cost: 1 } },
      cost: 1,
      consumed: ['a'],
      notes: [],
      audit: [],
      exp: 0,
    } as unknown as Parameters<typeof fallbackCraftNarration>[0];
    expect(fallbackCraftNarration(plan, ['a'])).toContain('差了那一步');
  });
});
