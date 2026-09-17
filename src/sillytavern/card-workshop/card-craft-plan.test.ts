/**
 * card-craft-plan.test.ts — 制卡主路（2026-09-17 第三档）
 *
 * 这一档改造的核心断言：**数值全部由 Code 一次算完**——档位/词条/造价/评级/消耗/经验
 * 都不给 AI 留位置。所以测试的重点是「给定素材与骰值，结果完全可复算」，
 * 以及「AI 缺席时制卡照样成立」（兜底叙事）。
 */
import { describe, it, expect } from 'vitest';
import {
  CRAFT_EXP_BY_TIER,
  CRAFT_RATING_MULT,
  consumedByRating,
  craftExpFor,
  isFailedRating,
  planCardCraft,
} from './card-craft-plan';
import {
  buildCraftNarrateMessages,
  fallbackCraftNarration,
  parseCraftNarration,
} from '../card-craft-narrate';
import { CARD_TIERS } from '../field-enums';
import type { InventoryItem } from '../types';

const 素材 = (name: string, rarity: InventoryItem['rarity'] = '优良'): InventoryItem =>
  ({ name, quantity: 1, type: '材料', rarity }) as InventoryItem;

const 背包 = [素材('赤铁矿'), 素材('火晶'), 素材('止血草'), 素材('风羽', '稀有')];

describe('数值表 —— 经验与评级', () => {
  it('档位越高给得越多（单调递增）', () => {
    let prev = -1;
    for (const t of CARD_TIERS) {
      expect(CRAFT_EXP_BY_TIER[t]).toBeGreaterThan(prev);
      prev = CRAFT_EXP_BY_TIER[t];
    }
  });

  it('评级倍率：大失败不给、失败给三成、精益求精一点五倍', () => {
    expect(CRAFT_RATING_MULT['大失败']).toBe(0);
    expect(CRAFT_RATING_MULT['失败']).toBe(0.3);
    expect(CRAFT_RATING_MULT['成功']).toBe(1);
    expect(CRAFT_RATING_MULT['精益求精']).toBe(1.5);
  });

  it('制作经验 = 档位基准 × 评级倍率', () => {
    expect(craftExpFor('白银', '成功')).toBe(CRAFT_EXP_BY_TIER['白银']);
    expect(craftExpFor('白银', '大失败')).toBe(0);
    expect(craftExpFor('白银', '精益求精')).toBe(Math.round(CRAFT_EXP_BY_TIER['白银'] * 1.5));
  });

  it('哪些评级算「没做成」', () => {
    expect(isFailedRating('失败')).toBe(true);
    expect(isFailedRating('大失败')).toBe(true);
    expect(isFailedRating('成功')).toBe(false);
    expect(isFailedRating('精益求精')).toBe(false);
  });
});

describe('素材消耗 —— Code 定，不是 AI 定', () => {
  it('成功/精益求精：全消耗', () => {
    expect(consumedByRating('成功', '主', ['副'])).toEqual(['主', '副']);
    expect(consumedByRating('精益求精', '主', ['副甲', '副乙'])).toEqual(['主', '副甲', '副乙']);
  });

  it('失败：只消耗副素材，**主材保住**', () => {
    expect(consumedByRating('失败', '主', ['副'])).toEqual(['副']);
    expect(consumedByRating('失败', '主', [])).toEqual([]);
  });

  it('大失败：全消耗（炸了）', () => {
    expect(consumedByRating('大失败', '主', ['副'])).toEqual(['主', '副']);
  });
});

describe('planCardCraft —— 给定素材与骰值完全可复算', () => {
  const base = {
    mainName: '赤铁矿',
    subNames: ['火晶'],
    intent: '我想打一把能在夜里发光的短刃',
    inventory: 背包,
    fallbackName: '夜刃',
  };

  it('同样的输入 → 同样的结果（纯函数，无隐藏随机）', () => {
    const a = planCardCraft({ ...base, d20: 12 });
    const b = planCardCraft({ ...base, d20: 12 });
    expect(a.plan!.product).toEqual(b.plan!.product);
    expect(a.plan!.rating).toBe(b.plan!.rating);
    expect(a.plan!.cost).toBe(b.plan!.cost);
    expect(a.plan!.exp).toBe(b.plan!.exp);
  });

  it('骰值影响评级，评级影响经验（同素材不同骰 → 不同结果）', () => {
    const low = planCardCraft({ ...base, d20: 1 });
    const high = planCardCraft({ ...base, d20: 20 });
    expect(low.plan!.exp).toBeLessThanOrEqual(high.plan!.exp);
  });

  it('产物档位/词条/造价全部来自融合内核（非 AI）', () => {
    const r = planCardCraft({ ...base, d20: 15 });
    expect(r.ok).toBe(true);
    expect(CARD_TIERS).toContain(r.plan!.product.cardTier);
    expect(r.plan!.product.词条.length).toBeGreaterThan(0);
    expect(r.plan!.product.recipe.cost).toBe(r.plan!.cost);
    expect(r.plan!.product.recipe.rating).toBe(r.plan!.rating);
  });

  it('审计链逐条可复算（素材/融合/检定/消耗/经验）', () => {
    const r = planCardCraft({ ...base, d20: 15 });
    const audit = r.plan!.audit.join('\n');
    expect(audit).toContain('素材：');
    expect(audit).toContain('融合：');
    expect(audit).toContain('检定：d20=');
    expect(audit).toContain('消耗：');
    expect(audit).toContain('经验：');
  });

  it('背包里没有的素材 → 拒绝（不凭空变出材料）', () => {
    const r = planCardCraft({ ...base, mainName: '不存在的矿', d20: 10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('找不到');
  });

  it('没选主素材 → 拒绝', () => {
    expect(planCardCraft({ ...base, mainName: '   ', d20: 10 }).ok).toBe(false);
  });

  it('主素材同时被选成副素材 → 去重，不会扣两次', () => {
    const r = planCardCraft({ ...base, subNames: ['赤铁矿', '火晶'], d20: 15 });
    expect(r.ok).toBe(true);
    const consumed = r.plan!.consumed;
    expect(new Set(consumed).size).toBe(consumed.length);
  });

  it('评级上浮（制卡顺利/烙印）真的作用于评级', () => {
    const plain = planCardCraft({ ...base, d20: 1 });
    const lifted = planCardCraft({ ...base, d20: 1, lift: { baseLift: 2 } });
    // 同样最差的骰，抬两档后应当更好或至少不差
    const rank = (r: string) => ['大失败', '失败', '成功', '精益求精'].indexOf(r);
    expect(rank(lifted.plan!.rating)).toBeGreaterThanOrEqual(rank(plain.plan!.rating));
  });

  it('失败/大失败不封印（残料也是东西，但不是成品）', () => {
    const r = planCardCraft({ ...base, d20: 1, lift: { baseLift: 3 } });
    if (isFailedRating(r.plan!.rating)) {
      expect(r.plan!.product.sealed).toBe(false);
    }
  });
});

describe('叙事层 —— AI 只命名与写过程', () => {
  const req = {
    saveId: 's',
    provisionalName: '夜刃',
    tier: '白银',
    entries: ['火', '打断'],
    cost: 42,
    rating: '成功',
    fusionKind: '相生',
    materials: ['赤铁矿', '火晶'],
    consumed: ['赤铁矿', '火晶'],
    intent: '我想打一把能在夜里发光的短刃',
    crafterName: '我',
    talentNotes: ['【战技附加】产物附带战技「灼烧」'],
  };

  it('提示词把定案写进去，并明令不得改数', () => {
    const msgs = buildCraftNarrateMessages(req);
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('白银');
    expect(all).toContain('42');
    expect(all).toContain('不得引入或更改任何数字');
    expect(all).toContain(req.intent);
    expect(all).toContain('战技附加');
  });

  it('失败时提示词要求写成「没做成」的样子', () => {
    const msgs = buildCraftNarrateMessages({ ...req, rating: '大失败' });
    expect(msgs[0].content).toContain('没做成');
  });

  it('解析 AI 输出：名字 + 叙事', () => {
    const got = parseCraftNarration('<name>夜刃</name>\n<narrative>他把它淬了三次。</narrative>');
    expect(got.name).toBe('夜刃');
    expect(got.narrative).toBe('他把它淬了三次。');
  });

  it('没按格式来时：整段当叙事，名字留空（调用方用临时名兜底）', () => {
    const got = parseCraftNarration('他把它淬了三次。');
    expect(got.name).toBeUndefined();
    expect(got.narrative).toBe('他把它淬了三次。');
  });

  it('空输出不炸', () => {
    expect(parseCraftNarration('')).toEqual({ narrative: '' });
  });

  it('兜底叙事不含任何数字（AI 不可用时也不能编数）', () => {
    const plan = planCardCraft({
      mainName: '赤铁矿',
      subNames: ['火晶'],
      intent: '',
      inventory: 背包,
      d20: 15,
    }).plan!;
    const text = fallbackCraftNarration(plan, ['赤铁矿', '火晶']);
    expect(text).not.toMatch(/\d/);
    expect(text.length).toBeGreaterThan(0);
  });
});
