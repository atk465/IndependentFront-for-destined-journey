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


patch('src/sillytavern/card-workshop/talent-entry.ts', [
    # kind union
    (
        "  | '经验倍率'; // 通用经验获取倍率（C「快速成长」等）",
        "  | '经验倍率' // 通用经验获取倍率（C「快速成长」等）\n  | '交易折扣'; // 商店购买折扣 %（C「讨价还价」/B「黑市贵宾」）"
    ),
    # params: syncPct is the last field before closing }
    (
        "    syncPct?: number;\n  };",
        "    syncPct?: number;\n    /** 交易折扣：商店购买折扣 %（clamp 到 0..50） */\n    discountPct?: number;\n  };"
    ),
    # 白名单
    (
        "  经验倍率: { expMult: [2] },\n};",
        "  经验倍率: { expMult: [2] },\n  交易折扣: { discountPct: [5, 10, 15] },\n};"
    ),
    # 基准
    (
        "  经验倍率: { expMult: 2 },\n} as const;",
        "  经验倍率: { expMult: 2 },\n  交易折扣: { discountPct: 5 },\n} as const;"
    ),
    # 选填数值
    (
        "  经验倍率: ['expMult'],\n};",
        "  经验倍率: ['expMult'],\n  交易折扣: ['discountPct'],\n};"
    ),
    # 池条目
    (
        "  e({ kind: '经验倍率', channel: 'universal', params: { expMult: 2 } }),",
        "  e({ kind: '经验倍率', channel: 'universal', params: { expMult: 2 } }),\n  e({ kind: '交易折扣', channel: 'universal', params: { discountPct: 5 } }),"
    ),
    # kind 清单
    (
        "  '经验倍率',\n];",
        "  '经验倍率',\n  '交易折扣',\n];"
    ),
    (
        "  '经验倍率',\n  '战技附加',\n]);",
        "  '经验倍率',\n  '交易折扣',\n  '战技附加',\n]);"
    ),
], '交易折扣 kind')

# 讨价还价 + 黑市贵宾
p = 'src/sillytavern/card-workshop/talent-entry.ts'
b = open(p, 'rb').read()
crlf = b'\r\n' in b
raw = b.decode('utf-8').replace('\r\n', '\n')

# 讨价还价：叙事→机械
m = re.search(r"(name: '讨价还价',[\s\S]*?)\n    entries: \[[^\]]*\],", raw)
assert m, 'NOT FOUND: 讨价还价'
block = m.group(0)
old_entries = "entries: [{ kind: '叙事意图', channel: 'universal', params: {} }],"
assert old_entries in block
new_entries = "entries: [{ kind: '交易折扣', channel: 'universal', params: { discountPct: 5 } }],"
raw = raw.replace(block, block.replace(old_entries, new_entries), 1)
print('OK  讨价还价')

# 黑市贵宾：追加交易折扣
m = re.search(r"(name: '黑市贵宾',[\s\S]*?)\n    entries: \[[^\]]*\],", raw)
assert m, 'NOT FOUND: 黑市贵宾'
block = m.group(0)
old_e = "entries: [{ kind: '叙事意图', channel: 'universal', params: {} }],"
assert old_e in block
new_e = "entries: [\n      { kind: '交易折扣', channel: 'universal', params: { discountPct: 10 } },\n      { kind: '叙事意图', channel: 'universal', params: {} },\n    ],"
raw = raw.replace(block, block.replace(old_e, new_e), 1)
print('OK  黑市贵宾')

open(p, 'wb').write(raw.replace('\n', '\r\n' if crlf else '\n').encode('utf-8'))

# 池清单
patch('src/sillytavern/card-workshop/talent-entry.test.ts', [
    ("    '经验倍率',\n  ];", "    '经验倍率',\n    '交易折扣',\n  ];"),
], '池清单')
