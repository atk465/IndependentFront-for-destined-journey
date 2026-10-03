import { describe, it, expect } from 'vitest';
import {
  buildSummonCompanion,
  isSummonCard,
  needsFirstSummon,
  companionBagOf,
  isCompanionDormant,
} from './companion';
import type { CardItem, CharacterState, InventoryItem } from '../types';

const summonCard = (
  name: string,
  词条: string[],
  cardTier: CardItem['cardTier'] = '鎏金',
  recipe?: CardItem['recipe'],
) =>
  ({ name, 词条, cardTier, description: '', ...(recipe ? { recipe } : {}) }) as Pick<
    CardItem,
    'name' | 'cardTier' | '词条' | 'description' | 'recipe'
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

describe('buildSummonCompanion（确定性实体化，§2.3 面板公式）', () => {
  it('type=summon、名字=卡名、面板按公式（真实配方：评级+素材项计入）', () => {
    // 鎏金×精益求精 = round(46×1.15)=53，素材 2 项×2 = +4 → T=57
    // 土→con 权重 4，其余 1（和 8）：floor 分配 7/7/28/7/7=56，余 1 归权重最高 con → 7/7/29/7/7
    const c = buildSummonCompanion({
      card: summonCard('远古巨兽·岩爪', ['土', '召唤'], '鎏金', {
        mainMaterial: '岩心材',
        subMaterials: ['苔砂'],
        tier: '鎏金',
        fusionKind: '相生',
        cost: 120,
        rating: '精益求精',
      }),
      seed: { race: '岩甲古龙裔', temperament: '寡言护主' },
      saveId: 'save1',
      playerName: '阿黑',
      location: '艾瑟嘉德',
    });
    expect(c.type).toBe('summon');
    expect(c.name).toBe('远古巨兽·岩爪');
    expect(c.race).toBe('岩甲古龙裔');
    expect(c.personality).toBe('寡言护主');
    expect(c.attributes).toEqual({ str: 7, dex: 7, con: 29, int: 7, spi: 7 });
    expect(c.maxHp).toBe(262); // 30 + 29×8
    expect(c.maxMp).toBe(85); // 15 + 7×6 + 7×4
    expect(c.maxSp).toBe(136); // 20 + 29×4
    expect(c.hp).toBe(c.maxHp);
    expect(c.level).toBe(1);
    expect(c.expToNext).toBe(1600); // CARD_EXP_CAP.鎏金
    expect(c.gender).toBe('女');
    expect(c.location).toBe('艾瑟嘉德');
    expect(c.customFields?.origin).toBe('summon_card');
  });

  it('无配方（目录入口）→ 评级按成功、素材项 0；无种子落「铭灵」口径，仍确定性', () => {
    // 星辉×成功 = 58；水→spi 权重 4（和 8）：floor 分配 7/7/7/7/29=57，余 1 归权重最高 spi → 7/7/7/7/30
    const a = buildSummonCompanion({
      card: summonCard('雾渊鲛姬', ['水', '召唤'], '星辉'),
      saveId: 'save1',
      playerName: '阿黑',
      location: '灰港',
    });
    expect(a.race).toBe('铭灵');
    expect(a.attributes).toEqual({ str: 7, dex: 7, con: 7, int: 7, spi: 30 });
    expect(a.maxHp).toBe(86); // 30 + 7×8
    expect(a.maxMp).toBe(177); // 15 + 7×6 + 30×4
    expect(a.maxSp).toBe(48); // 20 + 7×4
    expect(a.level).toBe(1);
    expect(a.expToNext).toBe(3200); // CARD_EXP_CAP.星辉
    const b = buildSummonCompanion({
      card: summonCard('雾渊鲛姬', ['水', '召唤'], '星辉'),
      saveId: 'save1',
      playerName: '阿黑',
      location: '灰港',
    });
    // 除 id 外全字段一致（确定性）
    expect({ ...b, id: '' }).toEqual({ ...a, id: '' });
  });

  it('目录占位配方（mainMaterial=卡名+0副素材）→ 同目录入口：素材项 0；扩展袋在位', () => {
    // 黑铁×成功 = 20；火→str 权重 4（和 8）：floor 分配 10/2/2/2/2=18，余 2 → str11/dex3
    const c = buildSummonCompanion({
      card: summonCard('愤怨瓷心·艾拉', ['火', '召唤'], '黑铁', {
        mainMaterial: '愤怨瓷心·艾拉',
        subMaterials: [],
        tier: '黑铁',
        fusionKind: '叠加',
        cost: 0,
        rating: '成功',
      }),
      saveId: 'save1',
      playerName: '阿黑',
      location: '灰港',
    });
    expect(c.attributes).toEqual({ str: 11, dex: 3, con: 2, int: 2, spi: 2 });
    expect(c.maxHp).toBe(46); // 30 + 2×8
    expect(c.maxMp).toBe(35); // 15 + 2×6 + 2×4
    expect(c.expToNext).toBe(200); // CARD_EXP_CAP.黑铁
    expect(c.customFields?.companion).toEqual({
      bornTier: '黑铁',
      equip: {},
      evolution: { unlocked: false, offerings: [] },
      injured: false,
    });
    // 伙伴天赋（批④ B4.6）：AI 未给 kind → 回落表（火→嗜血）；params = round(15×1.0)
    expect(c.talents?.capacity).toBe(1);
    expect(c.talents?.list).toHaveLength(1);
    const entry = c.talents?.list[0]?.entries[0];
    expect(entry?.kind).toBe('嗜血');
    expect(entry?.channel).toBe('universal');
    expect(entry?.params).toEqual({ bonus: 15 });
    expect(c.talents?.list[0]?.name).toBe('黑铁·嗜血');
  });
});

describe('companionBagOf 门禁', () => {
  const baseEntity = {
    customFields: { origin: 'summon_card' },
  } as unknown as CharacterState;

  it('合法袋透传（建袋形状）', () => {
    const e = {
      customFields: {
        companion: { bornTier: '黑铁', equip: {}, evolution: { unlocked: false, offerings: [] } },
      },
    } as unknown as CharacterState;
    const bag = companionBagOf(e);
    expect(bag).not.toBeNull();
    expect(bag?.bornTier).toBe('黑铁');
    expect(bag?.evolution.unlocked).toBe(false);
  });

  it('缺袋（旧档实体）返回 null，不抛', () => {
    expect(companionBagOf(baseEntity)).toBeNull();
    expect(companionBagOf({ customFields: {} } as unknown as CharacterState)).toBeNull();
  });

  it('形状非法返回 null（bornTier 非法 / evolution 缺字段）', () => {
    expect(
      companionBagOf({
        customFields: {
          companion: { bornTier: '秘银', equip: {}, evolution: { unlocked: false, offerings: [] } },
        },
      } as unknown as CharacterState),
    ).toBeNull();
    expect(
      companionBagOf({
        customFields: { companion: { bornTier: '黑铁', equip: {}, evolution: {} } },
      } as unknown as CharacterState),
    ).toBeNull();
  });
});

describe('isCompanionDormant（休眠纯派生）', () => {
  const card = (name: string, quantity: number): InventoryItem => ({
    name,
    quantity,
    type: '卡牌',
  });

  it('持有同名卡（含多张分存）→ 不休眠', () => {
    const inv = [card('火球术', 1), card('岩甲', 2), { name: '火球术', quantity: 1 }];
    expect(isCompanionDormant('火球术', inv)).toBe(false);
  });

  it('同名卡为 0（无条目/仅非卡牌同名物）→ 休眠', () => {
    expect(isCompanionDormant('火球术', [card('岩甲', 2)])).toBe(true);
    // 同名但是材料（非卡牌）不算持有
    expect(isCompanionDormant('火球术', [{ name: '火球术', quantity: 3, type: '材料' }])).toBe(
      true,
    );
    expect(isCompanionDormant('火球术', [])).toBe(true);
  });
});
