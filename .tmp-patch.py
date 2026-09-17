import re, sys

p = 'src/sillytavern/card-workshop/talent-entry.ts'
b = open(p, 'rb').read()
crlf = b'\r\n' in b
raw = b.decode('utf-8').replace('\r\n', '\n')

# Check which ones already have entries
fills = {
    '行走印钞机系统': "    // 2026-09-18 缺量批次：移动距离（缺量），先给叙事入口。\n    entries: [{ kind: '叙事意图', channel: 'universal', params: {} }],",
}

for name, replacement in fills.items():
    m = re.search(r"(name: '" + re.escape(name) + r"',[\s\S]*?)\n    entries: \[[^\]]*\],", raw)
    assert m, f'NOT FOUND: {name}'
    block = m.group(0)
    assert '\n    entries: [],' in block, f'{name} already filled'
    raw = raw.replace(block, block.replace("\n    entries: [],", "\n" + replacement), 1)
    print('OK  ', name)

open(p, 'wb').write(raw.replace('\n', '\r\n' if crlf else '\n').encode('utf-8'))

# Verify all 5
back = open(p, 'rb').read().decode('utf-8')
names = ['厨神？', '美食家系统', '污秽洗礼', '行走印钞机系统', '过载专家']
for name in names:
    seg = back.split(f"name: '{name}'")[1][:600]
    ok = '叙事意图' in seg or '成品限定' in seg or '配方解锁' in seg
    print(('OK  ' if ok else 'MISSING  ') + name)
    if not ok:
        sys.exit(1)
print('All 5 landed')
