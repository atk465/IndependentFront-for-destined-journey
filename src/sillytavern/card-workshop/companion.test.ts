import { describe, it, expect } from 'vitest';
import { buildSummonCompanion, isSummonCard, needsFirstSummon } from './companion';
import type { CardItem } from '../types';

const summonCard = (name: string, 词条: string[], cardTier: CardItem['cardTier'] = '鎏金') =>
  ({ name, 词条, cardTier, description: '' }) as Pick<
    CardItem,
    'name' | 'cardTier' | '词条' | 'description'
  >;

describe('isSummonCard / needsFirstSummon', () => {
  it('召唤卡命中；军团卡排除（群像不个体化）', () => {
    expect(isSummonCard(summonCard('远古巨兽·岩爪', ['土', '召唤']))).toBe(true);
    expect(isSummonCard(summonCard('虫巢兵潮', ['土', '军团']))).toBe(false);
    expect(isSummonCard(summonCard('苍穹之翼', ['金', '装备']))).toBe(false);
  });

  it('首召判定：存档内无同名角色', () => {
    expect(needsFirstSummon('岩爪', ['玩家', '小篆'])).toBe(true);
    expect(needsFirstSummon('岩爪', ['玩家', '岩爪'])).toBe(false);
  });
});

describe('buildSummonCompanion（确定性实体化）', () => {
  it('type=summon、名字=卡名、属性按档位推导', () => {
    const c = buildSummonCompanion({
      card: summonCard('远古巨兽·岩爪', ['土', '召唤'], '鎏金'),
      seed: { race: '岩甲古龙裔', temperament: '寡言护主' },
      saveId: 'save1',
      playerName: '阿黑',
      location: '艾瑟嘉德',
    });
    expect(c.type).toBe('summon');
    expect(c.name).toBe('远古巨兽·岩爪');
    expect(c.race).toBe('岩甲古龙裔');
    expect(c.personality).toBe('寡言护主');
    // 鎏金 idx=3 → 五维 5
    expect(c.attributes).toEqual({ str: 5, dex: 5, con: 5, int: 5, spi: 5 });
    expect(c.gender).toBe('女');
    expect(c.location).toBe('艾瑟嘉德');
    expect(c.customFields?.origin).toBe('summon_card');
  });

  it('无种子 → 落「铭灵」通用口径，仍确定性', () => {
    const a = buildSummonCompanion({
      card: summonCard('雾渊鲛姬', ['水', '召唤'], '星辉'),
      saveId: 'save1',
      playerName: '阿黑',
      location: '灰港',
    });
    expect(a.race).toBe('铭灵');
    // 星辉 idx=4 → 五维 6
    expect(a.attributes.str).toBe(6);
    const b = buildSummonCompanion({
      card: summonCard('雾渊鲛姬', ['水', '召唤'], '星辉'),
      saveId: 'save1',
      playerName: '阿黑',
      location: '灰港',
    });
    // 除 id 外全字段一致（确定性）
    expect({ ...b, id: '' }).toEqual({ ...a, id: '' });
  });
});
