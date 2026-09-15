# 事件、状态、查询与边沿语义模式

模式 ID：`PAT-SEM-01`

本文件用于解决极客版中最容易产生“图能保存但行为不对”的一类问题：把事件、持续状态、查询结果和状态边沿混成同一种信号。

这里的推荐结构只描述通用语义。具体节点字段仍以 `../mijia-complete-reference.md`、真实 MIoT Spec、网关回读和实机日志为准。

## 1. 先给每条信息分型

设计规则前，把每个输入标成三类之一：

| 类型 | 含义 | 典型来源 | 主要用途 |
|---|---|---|---|
| `EVENT` | “刚刚发生了一次” | 按键、门锁事件、定时到点、`varChange`、`onLoad` | 推动流程执行 |
| `STATE` | “现在是否成立” | `timeRange`、自定义状态、逻辑状态、设备当前条件 | 提供 `condition.condition` 或逻辑输入 |
| `QUERY` | “收到事件后，再去读取现实状态” | `deviceGet`、`varGet` | 把现实状态转换为流程分支 |

最小原则：

```text
EVENT 负责“什么时候开始算”
STATE 负责“现在是否允许”
QUERY 负责“执行到这里时现实是什么”
```

不要因为节点都有 `output` 就认为输出语义相同。

## 2. 事件源和查询节点不是替代关系

### 设备事件

```text
设备主动上报 / 事件发生
    ↓
deviceInput
    ↓
业务流程
```

适合“设备一变化就立即开始处理”。

### 设备查询

```text
已有 EVENT
    ↓
deviceGet
    ├─ 满足比较条件 → output
    └─ 不满足       → output2
```

适合“流程已经开始，现在确认设备真实状态”。

反模式：希望“灯一打开就执行”，却只放一个 `deviceGet`。查询节点本身不是事件订阅器。

## 3. `condition` 的事件入口和状态入口必须分别满足

`condition` 表达的是：

```text
EVENT → condition.trigger
STATE → condition.condition
```

只有持续维护状态而没有事件进入 `trigger`，不会凭空执行动作。

如果业务含义是“条件刚成立就执行”，那么“条件更新”本身还必须形成一个事件路径；不能只把状态接到 `condition.condition` 后等待它自己触发。

## 4. 事件合并与状态逻辑必须分开

```text
signalOr = 任一 EVENT 到达就产生一次 EVENT
logicOr  = 多个 STATE 的布尔 OR
logicAnd = 多个 STATE 的布尔 AND
logicNot = 一个 STATE 的布尔取反
```

常见错误：

```text
logicNot.output → deviceOutput.trigger
```

`logicNot` 的输出仍是状态，不应因为端口名叫 `output` 就当作普通执行事件。

需要“任一状态变化时重新计算”时，应该建立对应的事件路径，再使用 `signalOr` 汇合；状态逻辑只负责告诉判断节点当前真假。

## 5. 自定义状态 / register 是锁存状态，不是万能事件

自定义状态适合把瞬时事件转换成可持续读取的布尔状态：

```text
开始事件 → register.setTrue
结束/复位事件 → register.setFalse
register.output → 后续状态判断
```

设计 register 时必须回答：

1. 什么事件置真？
2. 什么事件置假？
3. 规则启用或网关重启时如何得到确定初值？
4. 它的 output 是被当作持续状态读取，还是利用 false→true 的上升沿？
5. 异常路径有没有复位？

只写 `setTrue` 而没有 `setFalse`，通常会得到“一开始能用，之后像失效”的状态机。

register 不等于教程语境中的“物理寄存器”。后者通常指设备上一个可读、可写、最好有断电记忆且不影响主功能的真实属性；也不等同于数值/字符串变量。

## 6. 原始值发生变化，不等于谓词真假发生变化

这是“规则只执行一次”或“某些变化没触发”的高频来源。

例如把一个状态条件写成：

```text
x >= 0
```

若原始值：

```text
111 → 0
```

设备值确实改变，但谓词结果仍然是：

```text
true → true
```

如果底层触发语义依赖“条件真假边沿”，这不能代表“任意数值变化”。

对于有限状态码，需要把有业务意义的状态显式分支。例如：

```text
x = 0  ─┐
        ├─ signalOr → 重新计算派生状态
x >= 1 ─┘
```

或者直接使用能够表达原始更新事件的设备/变量事件节点。

因此，设计时必须先问：

> 我需要的是“值更新事件”，还是“某个条件从 false 变 true”？

两者不能互换。

## 7. 状态可能是 UNKNOWN，不只有 true / false

网关保存的设备状态可能是最近已知值。刚启动、设备离线、设备长时间未上报或状态回传存在延迟时，业务层不应把“无法确认”直接等价成 false。

安全的三态思考：

```text
TRUE    已确认满足
FALSE   已确认不满足
UNKNOWN 当前无法可靠确认
```

处理方式按风险选择：

- 规则启动时做 preload / onLoad 查询；
- 使用就绪变量或最后更新时间；
- 额外检查在线状态；
- UNKNOWN 时停止高风险动作，而不是默认走 false 分支。

`deviceGet.output2` 只表示比较结果“不满足”，不是专门的查询失败 / UNKNOWN 输出。

## 8. 设计检查表

复杂规则生成前至少检查：

```text
[ ] 每条关键边已标 EVENT / STATE / QUERY
[ ] 所有 deviceGet 都有明确事件来源
[ ] 所有 condition 同时有 trigger 和 condition 语义来源
[ ] signalOr 没有被拿来代替状态 OR
[ ] logicOr/And/Not 没有被拿来代替事件合并
[ ] register 有置真、置假、初始化和异常复位
[ ] “任意变化”没有用一个长期恒真的谓词冒充
[ ] 启动/离线/陈旧状态的 UNKNOWN 有处理策略
[ ] 静态校验后仍安排运行日志验证
```

## 9. 与其他模式的组合

- 需要跨事件保存业务状态：`PAT-STATE-01`
- 手动操作优先于自动化：`PAT-STATE-02`
- 外部控制导致内部模式游标失真：`PAT-SYNC-01` + `PAT-LOOP-01`
- 人体/占用持续时间：`PAT-TIME-01`
- 虚拟事件、私有枚举与探针：`PAT-ADAPT-01`

## 10. 证据与来源

本模式是“公开视频设计语义 + 仓库已有网关节点参考 + 已记录运行实验”的合并结果，不把视频口述直接当成硬规则。

公开来源见 `../sources/catalog.md`，重点包括：

- `SRC-BILI-EASY-BASIC`
- `SRC-BILI-EASY-LOGIC`
- `SRC-BILI-EASY-EDGE`
- `SRC-BILI-BUG-STATE`
- `SRC-DY-BUG-PRELOAD`

已有运行证据见 `../experiments/index.md`。未完成实机确认的边界继续保留在 experiments，不升级为 validator error。
