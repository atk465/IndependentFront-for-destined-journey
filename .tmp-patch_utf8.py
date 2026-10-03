import sys

def patch(path, edits, label):
    b = open(path, 'rb').read()
    crlf = b'\r\n' in b
    text = b.decode('utf-8').replace('\r\n', '\n')
    for i, (old, new) in enumerate(edits):
        n = text.count(old)
        assert n == 1, f'{label} #{i}: 命中 {n} 次\n---old---\n{old[:300]}'
        text = text.replace(old, new, 1)
    open(path, 'wb').write(text.replace('\n', '\r\n' if crlf else '\n').encode('utf-8'))
    print(f'OK  {label}（{"CRLF" if crlf else "LF"}）')


# ── ① 条目种类：暴击 / 伤势 / 多敌 / 冷却 / 体型 / 负面
patch('src/sillytavern/card-workshop/talent-entry.ts', [
    (
        "  | '独行'; // 产出的生物卡独行时效果翻倍（A「孤狼」）",
        "  | '独行' // 产出的生物卡独行时效果翻倍（A「孤狼」）\n  | '暴击' // 拍内暴击：几率%与倍率（A「荒野镖客」/B「战场直觉」）\n  | '嗜血' // 伙伴卡低伤势时攻击提升（A「虐待狂化」）\n  | '处决' // 可对重伤敌人处决（B「处刑者」）\n  | '群威' // 敌人多且弱时全属性提升（A「小人国的女王」）\n  | '快咏' // 技能冷却与 MP 消耗减半（B「快速咏唱」）\n  | '体型压制' // 攻击远小于自己的敌人时额外伤害（B「体格差压制」）\n  | '狂化'; // 玩家处于负面状态时攻击提升（B「宿醉狂暴」）",
    ),
    # params
    (
        """    /** 条件加成：阈值之上每个的追加 %（触发阈值复用 threshold，语义同为「达到」） */
    perExtra?: number;""",
        """    /** 条件加成：阈值之上每个的追加 %（触发阈值复用 threshold，语义同为「达到」） */
    perExtra?: number;
    /** 暴击：几率（%）/ 倍率（×） */
    chance?: number;
    critMult?: number;
    /** 嗜血：低伤势阈值（%）/ 触发后攻击提升 % */
    hurtPct?: number;
    /** 处决：可处决的伤势阈值（%）/ 威慑伤 */
    shockPower?: number;
    /** 快咏：冷却拍数基准（用于减半） */
    beatCooldown?: number;
    /** 体型压制：额外行动值 % */
    crushPct?: number;
    /** 狂化：攻击倍率（×） */
    rageMult?: number;""",
    ),
    # 白名单
    (
        "  独行: {},\n};",
        """  独行: {},
  暴击: { chance: [15, 20], critMult: [2] },
  嗜血: { hurtPct: [30], percent: [30, 50] },
  处决: { hurtPct: [15], shockPower: [10] },
  群威: { threshold: [2], percent: [10, 15], perExtra: [5] },
  快咏: { percent: [50] },
  体型压制: { crushPct: [20, 30] },
  狂化: { rageMult: [2] },
};""",
    ),
    # 基准
    (
        "  独行: {},\n} as const;",
        """  独行: {},
  暴击: { chance: 20, critMult: 2 },
  嗜血: { hurtPct: 30, percent: 50 },
  处决: { hurtPct: 15, shockPower: 10 },
  群威: { threshold: 2, percent: 15, perExtra: 5 },
  快咏: { percent: 50 },
  体型压制: { crushPct: 30 },
  狂化: { rageMult: 2 },
} as const;""",
    ),
    # 选填数值表（把这些 kind 的数值参数标为「写了就要合法」）
    (
        "  独行: {},\n};",
        """  独行: {},
  暴击: ['chance', 'critMult'],
  嗜血: ['hurtPct', 'percent'],
  处决: ['hurtPct', 'shockPower'],
  群威: ['threshold', 'percent', 'perExtra'],
  快咏: ['percent'],
  体型压制: ['crushPct'],
  狂化: ['rageMult'],
};""",
    ),
    # 池条目
    (
        "  e({ kind: '独行', channel: 'universal', params: {} }),",
        """  e({ kind: '独行', channel: 'universal', params: {} }),
  e({ kind: '暴击', channel: 'universal', params: { chance: 20, critMult: 2 } }),
  e({ kind: '嗜血', channel: 'universal', params: { hurtPct: 30, percent: 50 } }),
  e({ kind: '处决', channel: 'universal', params: { hurtPct: 15, shockPower: 10 } }),
  e({\n    kind: '群威',\n    channel: 'universal',\n    params: { threshold: 2, percent: 15, perExtra: 5 },\n  }),\n  e({ kind: '快咏', channel: 'universal', params: { percent: 50 } }),\n  e({ kind: '体型压制', channel: 'universal', params: { crushPct: 30 } }),\n  e({ kind: '狂化', channel: 'universal', params: { rageMult: 2 } }),"""),
    # kind 清单
    ("  '条件加成',\n  '独行',\n];", "  '条件加成',\n  '独行',\n  '暴击',\n  '嗜血',\n  '处决',\n  '群威',\n  '快咏',\n  '体型压制',\n  '狂化',\n];"),
    (
        "  '条件加成',\n  '独行',\n  '战技附加',\n]);",
        "  '条件加成',\n  '独行',\n  '暴击',\n  '嗜血',\n  '处决',\n  '群威',\n  '快咏',\n  '体型压制',\n  '狂化',\n  '战技附加',\n]);",
    ),
], '战斗维度 条目种类')

# ── ② 模板填条目
p = 'src/sillytavern/card-workshop/talent-entry.ts'
b = open(p, 'rb').read()
crlf = b'\r\n' in b
raw = b.decode('utf-8').replace('\r\n', '\n')

fills = {
    '荒野镖客': (
        "    entries: [\n      {\n        kind: '条件加成',\n        channel: 'universal',\n        params: { cond: '无伙伴卡', threshold: 0, percent: 25, perExtra: 0 },\n      },\n      // 2026-09-17 战斗维度：暴击率 +15% → 拍内 15% 几率 ×2（「暴击率」终于有数值面）\n      {\n        kind: '暴击',\n        channel: 'universal',\n        params: { chance: 15, critMult: 2 },\n      },\n    ],"
    ),
    '战场直觉': (
        "    // 2026-09-17 战斗维度：暴击率 +20%（拍内 20% 几率 ×2）。\n    entries: [{ kind: '暴击', channel: 'universal', params: { chance: 20, critMult: 2 } }],"
    ),
    '虐待狂化': (
        "    // 2026-09-17 战斗维度：卡的伤势 ≤30%（重伤）时攻击 +50%——「卡有血」这件事\n    // 现在有了会话级近似（打出时满状态、每拍按敌方 dot 磨损）。\n    entries: [{ kind: '嗜血', channel: 'universal', params: { hurtPct: 30, percent: 50 } }],"
    ),
    '处刑者': (
        "    // 2026-09-17 战斗维度：对伤势 ≤15% 的敌人处决（震慑伤 = 全场敌方威胁 -10）。\n    entries: [{ kind: '处决', channel: 'universal', params: { hurtPct: 15, shockPower: 10 } }],"
    ),
    '小人国的女王': (
        "    // 2026-09-17 战斗维度：多敌维度落地——敌方数量由评估 Agent 声明（缺省 1）。\n    // 「等级低于自己」由评估对照玩家等级判定（评估 Agent 一并声明）。\n    entries: [\n      {\n        kind: '群威',\n        channel: 'universal',\n        params: { threshold: 2, percent: 15, perExtra: 5 },\n      },\n    ],"
    ),
    '快速咏唱': (
        "    // 2026-09-17 战斗维度：技能冷却维度落地（会话账：卡名→剩余拍数，每拍递减）。\n    // 「冷却与 MP 消耗减半」按快咏档位折算。\n    entries: [{ kind: '快咏', channel: 'universal', params: { percent: 50 } }],"
    ),
    '体格差压制': (
        "    // 2026-09-17 战斗维度：体型五档（玩家按等级派生、敌方由评估声明）；\n    // 攻击体型远小于自己（差距 ≥2）→ 行动值 +30%。\n    entries: [{ kind: '体型压制', channel: 'universal', params: { crushPct: 30 } }],"
    ),
    '宿醉狂暴': (
        "    // 2026-09-17 战斗维度：玩家负面状态标记（叙事侧置入、隔夜作废，与嘲讽标记同款）。\n    // 生效期间攻击 ×2（描述的「大幅提升」；倍率档 2）。\n    entries: [{ kind: '狂化', channel: 'universal', params: { rageMult: 2 } }],"
    ),
}
for name, replacement in fills.items():
    m = re.search(r"(name: '" + re.escape(name) + r"',[\s\S]*?)\n    entries: \[[^\]]*\],", raw)
    assert m, f'找不到：{name}'
    block = m.group(0)
    # 荒野镖客已有条目（条件加成），是「扩展」不是「填空」
    if '\n    entries: [],' in block:
        raw = raw.replace(block, block.replace("\n    entries: [],", "\n" + replacement), 1)
        print('OK  ', name, '（填空）')
    else:
        # 已有条目：找到 entries 列表结尾，追加
        m2 = re.search(r"(name: '" + re.escape(name) + r"',[\s\S]*?entries: \[)([^\]]*)(\],)", block)
        assert m2, f'{name} 追加失败'
        existing = m2.group(2)
        # 从 replacement 里抽出新增条目部分
        add_part = replacement.split('entries: ', 1)[1]
        new_entries = existing.rstrip() + ('\n' if existing.strip() else '') + '      ' + add_part.strip() + '\n    '
        new_block = block[: m2.start(2) - m2.start(0)] + new_entries + block[m2.end(2) - m2.start(0):]
        raw = raw.replace(block, new_block, 1)
        print('OK  ', name, '（追加）')
open(p, 'wb').write(raw.replace('\n', '\r\n' if crlf else '\n').encode('utf-8'))

# 池清单
patch('src/sillytavern/card-workshop/talent-entry.test.ts', [
    ("    '条件加成',\n    '独行',\n  ];",
     "    '条件加成',\n    '独行',\n    '暴击',\n    '嗜血',\n    '处决',\n    '群威',\n    '快咏',\n    '体型压制',\n    '狂化',\n  ];"),
], '池清单')
