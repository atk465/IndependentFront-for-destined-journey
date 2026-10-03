# 向量召回补齐 —— 记忆惰性回填设计（2026-09-16）

> 状态：已实施（`ba6b514`）
> 裁决人：主人（记忆系统「留，而且要把向量系统补齐」；Embedding API 已备：doubao-embedding-vision @ ark.cn-beijing.volces.com）

## 现状结论（实施前盘点）

向量召回管线**骨架早已接好**，本次盘点确认了四个「已有」：

| 环节               | 现状                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| summary 落库算向量 | `summarizeAndSave` → `computeEmbeddingWithMeta` → `memory.embedding + embeddingMeta` 原子成对（F09）—— game-pipeline `persistMemorySummary` 已传 `buildEmbeddingEndpoint()`                      |
| 向量检索           | `memory-store.recallMemories(saveId, query, topK, endpoint)`：查询端嵌一次 → 逐条分区（compatible/missing/incompatible/invalid）→ compatible 按余弦降序 → 不足槽位由 fallback（重要度+时间）补齐 |
| 自动路由           | orchestrator `callAgent`：`memory_recall` 且（模型名含 `embedding` 或 `apiType === 'embedding'`）→ `callMemoryRecallEmbedding`（不经 LLM）                                                       |
| 降级路径           | 查询端失败 → 全量 fallback（score=0，不伪装余弦分）—— 端点未配置时的既有行为                                                                                                                     |

**唯一真缺口**：旧记忆 `embedding === undefined` → 每次召回都归 `missing` → fallback 排序（重要度+时间），**永远进不了 compatible 段**。没有回填机制，这批记忆永远吃不到语义检索。

## 本次实施

### 1. 惰性回填（memory-store 新增 `backfillMissingMemories`）

```
backfillMissingMemories(saveId, scanTopN, endpoint, onEmbeddingRequest?)
  → { scanned, refilled, failed }
```

- 扫存档内 `embedding` 缺失的记忆，按**上限批次**（`LAZY_BACKFILL_MAX_PER_RECALL = 5`）走 `saveMemoryWithEmbedding` 重嵌落库
- 上限防历史债一次性爆发：端点刚上线时，几十条旧记忆不会一次性打爆配额
- 单条失败仅计数（failed），**不抛、不污染 db**——下一轮召回自动再试

### 2. 接线（game-pipeline.buildContext 末尾）

```
maybeBackfillMissingMemories()   // fire-and-forget
  ├─ buildEmbeddingEndpoint() 失败（未配置）→ 静默退避
  ├─ 成功 → void backfillMissingMemories(...).catch(warn)   // 不阻塞编排
  └─ 嵌入请求经 recordEmbeddingRequest 进调试账本（memory_embedding 条目）
```

放 buildContext（而非 recallMemories 内部）的理由：回填是**异步网络任务**，不能阻塞召回；buildContext 每轮必经，天然是「顺手扫一眼」的位置。

### 3. 路由判据测试（agent-orchestrator.test 4 条）

`memory_recall` 且（模型名含 embedding ∨ apiType=embedding）→ 向量路径；apiType=chat 或非 memory_recall agent → 不走。锁的是 orchestrator 里那个内联条件表达式。

## 生效时间线

```
主人配置 doubao 端点（已完成：apiType='embedding' 指向 ark.cn-beijing.volces.com）
        ↓
下一轮对话：memory_recall 自动走向量路径（旧记忆 fallback 排序，同时后台回填 5 条）
        ↓
几轮之内旧记忆全部补齐 → compatible 段接管 → 真正的语义召回
```

## 边界与注意

- **维度/模型一致性**：`classifyStoredVector` 按 `spaceId`（端点身份+模型派生）与维度分区——换 embedding 模型后旧向量自动归 incompatible 走 fallback，不会错误匹配；重嵌旧条即迁移
- **费用**：embedding 极廉（doubao 按千 token 计）；回填上限 5 条/轮天然限流
- **doubao-embedding-vision 是多模态模型**：文本嵌入可用，但若遇兼容问题可换 `doubao-embedding`（纯文本版）；API 形状同为 OpenAI 兼容 `/embeddings`
- **API Key 安全**：key 只进 Dexie `apiEndpoints`（已有机制），localStorage 脱敏

## 测试

- `memory-store.test.ts` 新增 7 条回填用例：零开销快路（全有向量）、批次落库（embedding+meta 成对）、上限生效、缺省常量、嵌入失败记 failed、单条坏数据不拖垮整批、空存档零网络
- 既有 79 条记忆测试全绿不变
