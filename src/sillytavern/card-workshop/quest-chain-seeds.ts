/**
 * quest-chain-seeds.ts — 禁忌卡七链种子（委托×地图闭环 2026-09-19 三批落地）
 *
 * 内容真源 = 独立资产仓 `data/content/quest-chains-seed.json`（主人审定）；本文件是
 * 引擎侧的播种投影（builtin-worldbooks 同款模式），两处改动须同步。
 *
 * 结构（每链三节，chainId/chainOrder 串联）：
 *   首节 requireVisit（亲赴探查）→ 中节 requireMaterial（独家素材）→ 末节 finale
 *   （谜题×3 / 强敌×2 / 场景制卡×1）。场景制卡的 target 一律是「钥匙卡」
 *   （如夜蜡引），禁忌卡正本玩家不可制作（canon 红线）。
 *   仅末节挂 issuerMidTier（A/S 级交付地，远征的「回来」只收一次尾）。
 *
 * 奖励卡（rewards.card, grantAt='scene'）指向七张禁忌卡名：卡池/自定义卡暂无此卡时
 * 交付流程按既有合同降级（发放注明「未发放」的 note）；主人用委托编写器/购卡编辑器
 * 建了同名自定义卡后即自动补发。
 *
 * 谜题型末节各配一条 exploration 终点事件（EVENT_SEEDS）：quest 门（对应委托进行中）
 * + once，玩家在目的地探索时必然可触发（不走概率），触发并结算即满足 finale 完成条件。
 *
 * 播种规则（game-store.loadCustomCommissionsAndEvents）：customCommissions 为空且
 * worldFlags.questChainSeeded !== true 时播种一次并落标记；之后编辑器里删改不受影响。
 */

import type { CommissionDef } from './commission';
import type { RandomEventDef } from '../types-random-events';

export const QUEST_CHAIN_COMMISSION_SEEDS: readonly CommissionDef[] = [
  {
    name: '无名河·灰柜判词', chainId: 'chain_wuminghe', chainOrder: 1, grade: 'A',
    description: '灰柜里那半页判决——河名既夺，河归无处。上半页去了哪，禁录库不说话，公会替一位不肯具名的委托人问一句。',
    requireVisit: { midTier: '冕京京畿', count: 1 }, destMidTier: '冕京京畿',
    deadlineDays: 10,
    rewards: { gc: 600, reputation: 4 },
  },
  {
    name: '无名河·界碑之尘', chainId: 'chain_wuminghe', chainOrder: 2, grade: 'A',
    description: '界碑的灰里混着不属于任何朝代的东西。拓碑客说：凑齐三份界碑尘，能拼出判决书被撕掉的那半行。',
    requireMaterial: { name: '界碑尘', count: 3 }, destMidTier: '无名录·边缘',
    deadlineDays: 12,
    rewards: { gc: 900, reputation: 5 },
  },
  {
    name: '无名河·河源之问', chainId: 'chain_wuminghe', chainOrder: 3, grade: 'S',
    description: '河源祭坛的最后一夜，河会自己问你它的名字。答不答、怎么答，回来亲口告诉那位委托人。', destMidTier: '无名录·边缘',
    finale: { type: '谜题', target: '河源之问' },
    issuerMidTier: '冕京京畿', deadlineDays: 14,
    rewards: { gc: 1800, reputation: 10, card: { name: '禁忌卡·无名河', grantAt: 'scene' } },
  },

  {
    name: '失年历·借雾人', chainId: 'chain_shinianli', chainOrder: 1, grade: 'A',
    description: '历法修道院的十二扇空窗对着十二个月。修道院不肯开口，但霜颸的花在风停的间隙里开——那年被偷走的月份，据说躲在花的香里。',
    requireVisit: { midTier: '霜颸北境', count: 1 }, destMidTier: '霜颸北境',
    deadlineDays: 10,
    rewards: { gc: 600, reputation: 4 },
  },
  {
    name: '失年历·颸冰之证', chainId: 'chain_shinianli', chainOrder: 2, grade: 'A',
    description: '最好的颸冰晶里冻着上一年的风。要证明那一年存在过，冻在晶体里的年痕是最老实的证人——采两枚，别化。',
    requireMaterial: { name: '颸冰晶', count: 2 }, destMidTier: '霜颸北境',
    deadlineDays: 12,
    rewards: { gc: 900, reputation: 5 },
  },
  {
    name: '失年历·岁末之页', chainId: 'chain_shinianli', chainOrder: 3, grade: 'S',
    description: '岁末钟楼敲响时，年历会自己翻到被撕的那一页。守历人说：那一页翻给谁看，谁就得替那一年作证。', destMidTier: '霜颸北境',
    finale: { type: '谜题', target: '岁末之页' },
    issuerMidTier: '冕京京畿', deadlineDays: 14,
    rewards: { gc: 1800, reputation: 10, card: { name: '禁忌卡·失年历', grantAt: 'scene' } },
  },

  {
    name: '焚天引·入会的资格', chainId: 'chain_fentianyin', chainOrder: 1, grade: 'A',
    description: '野铭者的地下集会有个古怪的门槛：想打听焚天引，先在谷地住到他们主动跟你说话为止。',
    requireVisit: { midTier: '野铭者谷地', count: 1 }, destMidTier: '野铭者谷地',
    deadlineDays: 10,
    rewards: { gc: 700, reputation: 3 },
  },
  {
    name: '焚天引·集会的贽礼', chainId: 'chain_fentianyin', chainOrder: 2, grade: 'A',
    description: '野铭者不收钱。集会的贽礼是三片野铭碎片——他们要看的不是碎片，是捡碎片的人有没有在荒地里活下来的沉稳。',
    requireMaterial: { name: '野铭碎片', count: 3 }, destMidTier: '野铭者谷地',
    deadlineDays: 12,
    rewards: { gc: 1000, reputation: 4 },
  },
  {
    name: '焚天引·裂隙边缘的三昼夜', chainId: 'chain_fentianyin', chainOrder: 3, grade: 'S',
    description: '守疤人会来问你抬手还是收手。答对了，天上的疤替你作证；答错了——野铭者的原话是「那就不用回来了，省路费」。', destMidTier: '底石裂隙',
    finale: { type: '强敌', target: '守疤人' },
    issuerMidTier: '野铭者谷地', deadlineDays: 14,
    rewards: { gc: 2000, reputation: 10, card: { name: '禁忌卡·焚天引', grantAt: 'scene' } },
  },

  {
    name: '万兽园·兽族的旧约', chainId: 'chain_wanshouyuan', chainOrder: 1, grade: 'A',
    description: '兽族的篝火故事讲到「园」字都压低声音。想知道园门在哪，先去东境边地听完整整三个晚上的故事——一个都不能打断。',
    requireVisit: { midTier: '东境', count: 1 }, destMidTier: '东境',
    deadlineDays: 10,
    rewards: { gc: 600, reputation: 4 },
  },
  {
    name: '万兽园·叩门的伴手', chainId: 'chain_wanshouyuan', chainOrder: 2, grade: 'A',
    description: '叩园门不能空手，兽族的老话是「带一把哨堡艾草，园主闻见就知道你不是来打猎的」。',
    requireMaterial: { name: '哨堡艾草', count: 3 }, destMidTier: '东境',
    deadlineDays: 12,
    rewards: { gc: 900, reputation: 5 },
  },
  {
    name: '万兽园·兽潮之夜', chainId: 'chain_wanshouyuan', chainOrder: 3, grade: 'S',
    description: '兽潮之夜叩园门，头狼会先到。它不是来拦你的——它是来确认你配不配被拦。', destMidTier: '东境',
    finale: { type: '强敌', target: '兽潮头狼' },
    issuerMidTier: '东境', deadlineDays: 14,
    rewards: { gc: 1800, reputation: 10, card: { name: '禁忌卡·万兽园', grantAt: 'scene' } },
  },

  {
    name: '称心秤·死当册的一页', chainId: 'chain_chengxinchen', chainOrder: 1, grade: 'A',
    description: '帝都当铺的死当册里，「称愿的」三个字出现过太多次。账房不肯给外人看册页，除非你先证明自己「许得起愿望」——去采三株晨露草，帝都的雾不骗人。',
    requireMaterial: { name: '晨露草', count: 3 }, destMidTier: '冕京京畿',
    deadlineDays: 10,
    rewards: { gc: 600, reputation: 4 },
  },
  {
    name: '称心秤·再不当秤的匠人', chainId: 'chain_chengxinchen', chainOrder: 2, grade: 'A',
    description: '那位再不当秤的女匠人住在京畿。她谁也不见，但京畿的人都知道：她数晨露草的时候，会在窗边多站一会儿。',
    requireVisit: { midTier: '冕京京畿', count: 1 }, destMidTier: '冕京京畿',
    deadlineDays: 10,
    rewards: { gc: 700, reputation: 4 },
  },
  {
    name: '称心秤·愿望的分量', chainId: 'chain_chengxinchen', chainOrder: 3, grade: 'S',
    description: '用你最舍不得的那件东西当砝码。秤会告诉你答案，秤也会记住你听见答案时的脸。', destMidTier: '冕京京畿',
    finale: { type: '谜题', target: '愿望的分量' },
    issuerMidTier: '冕京京畿', deadlineDays: 14,
    rewards: { gc: 1800, reputation: 10, card: { name: '禁忌卡·称心秤', grantAt: 'scene' } },
  },

  {
    name: '白蜡城·房东的香', chainId: 'chain_bailacheng', chainOrder: 1, grade: 'A',
    description: '晶蜥族记得所有借宿者的名字。想请房东开口讲白蜡城的旧事，先按老规矩给矿脉上三炷香——香要灰笺深髓屑制的，别拿次货。',
    requireMaterial: { name: '灰笺深髓', count: 2 }, destMidTier: '灰笺乡',
    deadlineDays: 10,
    rewards: { gc: 800, reputation: 5 },
  },
  {
    name: '白蜡城·封城旧档的裁口', chainId: 'chain_bailacheng', chainOrder: 2, grade: 'A',
    description: '蜡匠行会的封城旧档只剩四字：「客不欲明。」裁走边角的裁口很整齐——行会自己人干的。查清是哪一位，裁口就肯讲第二句。',
    requireVisit: { midTier: '灰笺乡', count: 1 }, destMidTier: '灰笺乡',
    deadlineDays: 12,
    rewards: { gc: 1000, reputation: 5 },
  },
  {
    name: '白蜡城·夜蜡引', chainId: 'chain_bailacheng', chainOrder: 3, grade: 'S',
    description: '在城里过完整整一夜且不点灯——但人总要一点光。夜蜡引是蜡匠行会的秘传：似明非明的那一点，城里的人看不见，你看得见。现场制出来，它带你进去，也带你出来。', destMidTier: '灰笺乡',
    finale: { type: '场景制卡', target: '夜蜡引', materials: [{ name: '灰笺深髓', quantity: 2 }] },
    issuerMidTier: '灰笺乡', deadlineDays: 14,
    rewards: { gc: 2000, reputation: 10, card: { name: '禁忌卡·白蜡城', grantAt: 'scene' } },
  },

  {
    name: '第一行·界碑之下', chainId: 'chain_diyi', chainOrder: 1, grade: 'S',
    description: '三块拓角，一块在无名录边缘的界碑之下。垣奴一族守了几百年，守的其实是一句话：拓角可以看，底石不能细读。',
    requireVisit: { midTier: '无名录·边缘', count: 1 }, destMidTier: '无名录·边缘',
    deadlineDays: 12,
    rewards: { gc: 1200, reputation: 6 },
  },
  {
    name: '第一行·腹地的重量', chainId: 'chain_diyi', chainOrder: 2, grade: 'S',
    description: '老院长说过：拓角只会给「背得动灭铭渣还面不改色」的人。这不是考验，是称重——腹地给你的东西，你拿得动多少，决定你配知道多少。',
    requireMaterial: { name: '灭铭核心', count: 1 }, destMidTier: '无名录·腹地',
    deadlineDays: 14,
    rewards: { gc: 1600, reputation: 8 },
  },
  {
    name: '第一行·接着不看', chainId: 'chain_diyi', chainOrder: 3, grade: 'S',
    description: '第三块拓角「可能就在你身边」。老院长交接词只有四个字：接着不看。当你终于明白这四个字是钥匙而不是拒绝——第一行会翻到你看的那一行。', destMidTier: '无名录·腹地',
    finale: { type: '谜题', target: '第一行之页' },
    issuerMidTier: '冕京京畿', deadlineDays: 14,
    rewards: { gc: 3000, reputation: 15, card: { name: '禁忌卡·第一行', grantAt: 'scene' } },
  },
];

/** 谜题型末节的探索终点事件（quest 门 + once；触发并结算即满足 finale 完成条件） */
export const QUEST_CHAIN_EVENT_SEEDS: readonly RandomEventDef[] = [
  {
    name: '河源之问',
    brief: '河源祭坛的最后一夜到了：水面无风自动，一个不属于任何活人的问题顺着水汽浮上来——它在问你它的名字。谜底不在卡里，在你听过的一切关于「被夺走名字」的旧事里。',
    trigger: { type: 'exploration', scope: { anyOf: ['无名录·边缘'] }, chancePct: 100 },
    once: true,
    priority: 10,
    available: { quest: { name: '无名河·河源之问', statusAnyOf: ['进行中'] } },
  },
  {
    name: '岁末之页',
    brief: '岁末钟楼的钟声比往常沉了一拍：一本没有署名的年历在你面前自己翻动，翻到那一页停住了。被撕走的那一年的十二行历铭，正在等你替它们把话说完。',
    trigger: { type: 'exploration', scope: { anyOf: ['霜颸北境'] }, chancePct: 100 },
    once: true,
    priority: 10,
    available: { quest: { name: '失年历·岁末之页', statusAnyOf: ['进行中'] } },
  },
  {
    name: '愿望的分量',
    brief: '当铺的匣子无风自开，一杆小秤横在柜面上——砝码的位置空着。它不收钱，只问你：你最舍不得的那件东西，此刻在不在你身上。',
    trigger: { type: 'exploration', scope: { anyOf: ['冕京京畿'] }, chancePct: 100 },
    once: true,
    priority: 10,
    available: { quest: { name: '称心秤·愿望的分量', statusAnyOf: ['进行中'] } },
  },
  {
    name: '第一行之页',
    brief: '「接着不看」——当你真的懂了这四个字，拓片的三块拓角在你面前自己拼合。第一行只亮了半行，另一半的方向，是你来时的路。',
    trigger: { type: 'exploration', scope: { anyOf: ['无名录·腹地'] }, chancePct: 100 },
    once: true,
    priority: 10,
    available: { quest: { name: '第一行·接着不看', statusAnyOf: ['进行中'] } },
  },
];
