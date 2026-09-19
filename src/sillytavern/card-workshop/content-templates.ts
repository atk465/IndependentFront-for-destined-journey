/**
 * content-templates.ts — 自定义内容模板（2026-09-18）
 *
 * 用途：开发者模式的「下载模板」按钮 + 手写 JSON 的形状参照。
 *
 * 🔴 每个模板都用 `satisfies` 钉在真实类型上 —— 接口改了字段而模板没跟上时
 *    `typecheck` 会直接报错，模板不会悄悄烂掉。示例值刻意取小整数/常见档位，
 *    让作者一眼能对着改。
 *
 * 导入契约见 `custom-content.ts` 的 `coerceCustomTalents` / `coerceCustomCards`：
 * 形状不对的条目**静默丢弃**（不会抛），所以模板里写错字段名不会炸游戏、
 * 但也看不到报错 —— 导入后请核对列表里是否出现。
 */

import type { CardCatalogItem, CardPoolFormEntry } from '../start-catalog-mechanics';
import type { TalentTemplate } from './talent-entry';
import { validateTalentEntries } from './talent-entry';
import { CARD_TIERS } from '../field-enums';

/**
 * 卡池可选形态。`as const satisfies` 保证拼错字会 typecheck 报错
 * （没有现成的枚举数组可 import —— CardPoolFormEntry 只是个联合类型）。
 */
const POOL_FORM_ENTRIES = [
  '装备',
  '技能',
  '领域',
  '物资',
  '召唤',
  '军团',
] as const satisfies readonly CardPoolFormEntry[];

/** 单条天赋模板（含注释字段；导入时 `_` 开头的键被忽略 —— 只读白名单字段） */
export const TALENT_TEMPLATE = {
  _说明: [
    '天赋模板：删掉 _ 开头的注释行，保留 name/grade/source/description/entries。',
    'grade：SSS/SS/S/A/B/C/D/E/F（定价按档走，见 docs/design 的档位表）。',
    'source：universal（通用池，捏人抽卡 + 声望兑换）/ creation（出身独占）/',
    '        story（剧情独占）/ fusion（融合产物——捏人抽不到）/ exchange（兑换独占）。',
    'entries：条目是天赋的**机制**部分，必须来自 TALENT_ENTRY_POOL 的 kind 与 params 组合，',
    '        否则 validateTalentEntries 会拒收（AI 零编数门禁）。',
    'description：风味文字，随便写，不参与计算。',
  ],
  name: '示例天赋 · 请改名',
  grade: 'A',
  source: 'universal',
  description: '风味描述：一句话讲清这个天赋在世界里长什么样。',
  entries: [{ kind: '行动值加成', channel: 'universal', params: { amount: 2 } }],
} satisfies TalentTemplate & Record<string, unknown>;

/** 单张购卡模板（含注释字段） */
export const CARD_TEMPLATE = {
  _说明: [
    '卡牌模板：删掉 _ 开头的注释行，保留 id/name/cardTier/formEntry/description/cost。',
    'id：唯一标识，建议 custom- 前缀（内置卡用内容仓里的 id，别撞）。',
    `cardTier：${CARD_TIERS.join(' / ')}（开局购卡计价 白铁 10 / 青铜 20 / 白银 40 / 鎏金 80 / 星辉 160）。`,
    `formEntry：${POOL_FORM_ENTRIES.join(' / ')}（装备/技能/领域/物资 可开局购买；召唤/军团 与叙事强耦合，不在开局购卡分栏里）。`,
    'element：可选，九元素之一；缺省 = 无元素铭文。',
    'cost：转生点计价，白铁 10 / 青铜 20 / 白银 40 / 鎏金 80 / 星辉 160（可自行调低调高）。',
    'yield：物资卡专属。没有 yield 的物资卡**无法使用**（防白消耗），只在背包里躺着。',
    '       素材卡（formEntry = 素材）进不了卡组，属于制卡材料来源，同样建议给 yield。',
  ],
  id: 'custom-example-001',
  name: '示例卡 · 请改名',
  cardTier: '青铜',
  formEntry: '物资',
  element: '火',
  description: '风味描述：这张卡在叙事里是什么、用起来什么感觉。',
  cost: 20,
  yield: { name: '示例产出物', quantity: 1, itemType: '消耗品' },
} satisfies CardCatalogItem & Record<string, unknown>;

/** 全套内容模板（可整体导入的容器形状 —— 与导出文件同构） */
export function buildTemplateBundle(): {
  version: number;
  _说明: string[];
  talents: unknown[];
  cards: unknown[];
} {
  return {
    version: 1,
    _说明: [
      '自定义内容模板。talents / cards 是数组，可以放多条。',
      '导入路径：设置 → 开发者模式 → 天赋/购卡编辑器 → 导入。',
      '导入时形状不对的条目会被静默丢弃（不抛错）——导入后请核对列表。',
      '模板里的示例条目会真的进池子，记得改名或删掉。',
    ],
    talents: [TALENT_TEMPLATE],
    cards: [CARD_TEMPLATE],
  };
}

/**
 * 模板自检（开发/测试用）：模板里的示例条目必须能通过各自的校验。
 *
 * 纯函数，不抛 —— 模板烂掉时返回原因字符串。
 */
export function checkTemplates(): { ok: boolean; reason?: string } {
  const v = validateTalentEntries(TALENT_TEMPLATE.entries as never);
  if (!v.ok) return { ok: false, reason: `天赋模板条目非法：${v.reason}` };
  if (!(CARD_TIERS as readonly string[]).includes(CARD_TEMPLATE.cardTier)) {
    return { ok: false, reason: `卡牌模板品质非法：${CARD_TEMPLATE.cardTier}` };
  }
  if (!POOL_FORM_ENTRIES.includes(CARD_TEMPLATE.formEntry)) {
    return { ok: false, reason: `卡牌模板形态非法：${CARD_TEMPLATE.formEntry}` };
  }
  return { ok: true };
}
