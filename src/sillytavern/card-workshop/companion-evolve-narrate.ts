/**
 * companion-evolve-narrate.ts — 进化仪式弧光句（伙伴实体化 B5.2b，R5 补缝）
 *
 * 仪式 commit 里的一句话弧光（background 追加）。AI 只写一句话，零数值——
 * 文风红线逐条入 prompt：一句话白描、≤30 字、禁空洞形容词、从蜕变机制与
 * 既有性格推导、只输出 <arc>…</arc>。
 *
 * 纯函数叶；调用由注入缝（evolveArcImpl）供给，失败/超时/空一律 null，
 * 绝不阻塞仪式 commit（与 craftNarrateImpl 注入缝同款纪律）。
 */

import { tagInner } from '../agent-xml';
import type { CardTier } from '../field-enums';

export interface EvolutionArcInput {
  name: string;
  personality?: string;
  archetype?: string;
  routeName?: string;
  routeDesc?: string;
  fromTier: CardTier;
  toTier: CardTier;
}

/** 组装弧光句消息（纯函数） */
export function buildEvolutionArcMessages(
  input: EvolutionArcInput,
): Array<{ role: string; content: string }> {
  const system = [
    '你是铭刻纪元的进化仪式记事官。一位伙伴刚在仪式中蜕去旧品阶、长出新的铭文。',
    '',
    '硬性规则：',
    '1. 只写一句话白描，不超过 30 字。',
    '2. 禁空洞形容词——强大、神秘、古老之类一律不许出现。',
    '3. 画面从蜕变机制（品阶跃迁/面板重锚/天赋升标）与她的既有性格推导。',
    '4. 只输出 <arc>…</arc> 标签，不要任何多余文字。',
    '5. 用中文。',
  ].join('\n');

  const user = [
    `伙伴：${input.name}`,
    `性格：${input.personality ?? '（未记）'}`,
    `倾向：${input.archetype ?? '（未定）'}${input.routeName ? `（${input.routeName}）` : ''}`,
    ...(input.routeDesc ? [`倾向描述：${input.routeDesc}`] : []),
    `品阶：${input.fromTier} → ${input.toTier}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 解析弧光句：<arc> 取内文 trim，超 30 字截断，空 → null（tagInner 既有口径） */
export function parseEvolutionArc(response: string): string | null {
  const arc = tagInner(String(response ?? ''), 'arc')
    ?.trim()
    .slice(0, 30);
  return arc && arc.length > 0 ? arc : null;
}
