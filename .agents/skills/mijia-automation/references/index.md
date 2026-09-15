# 米家自动化知识索引

按任务读取最少的参考文件，不要一次加载全部资料。

| 需求 | 读取 |
|---|---|
| 事件/状态/查询的区别、condition 双输入、signalOr 与 logic、register、状态边沿与 UNKNOWN | [patterns/event-state-semantics.md](patterns/event-state-semantics.md) |
| 节点字段、端口、完整 JSON 结构 | [mijia-complete-reference.md](mijia-complete-reference.md) |
| 变量保存状态、局部/全局作用域、查询新鲜度、触发与状态时序、时间窗寄存器 | [patterns/state-and-scope.md](patterns/state-and-scope.md) |
| 运算、取整、小数、量程转换 | [patterns/numeric-transforms.md](patterns/numeric-transforms.md) |
| 多传感器、最值、至少满足 k 个、求和兜底、否则与状态组合 | [patterns/aggregation-and-thresholds.md](patterns/aggregation-and-thresholds.md) |
| 时间戳、运行时长、日期、长周期提醒、节律窗口 | [patterns/time-and-duration.md](patterns/time-and-duration.md) |
| 循环、停止、模式归位、启动恢复 | [patterns/loops-and-lifecycle.md](patterns/loops-and-lifecycle.md) |
| 设备镜像、多设备跟随、状态驱动切换、防回环 | [patterns/synchronization.md](patterns/synchronization.md) |
| 设备适配层、虚拟事件协同、统一应答入口、可复用模板、观测探针 | [patterns/adapters-and-templates.md](patterns/adapters-and-templates.md) |
| 视频案例的脱敏关联索引 | [cases/catalog.md](cases/catalog.md) |
| 待验证方案和状态升级规则 | [experiments/index.md](experiments/index.md) |
| 公开教程来源与追溯 ID | [sources/catalog.md](sources/catalog.md) |
| 已确认事故、反例和通用限制 | [lessons-learned.md](lessons-learned.md) |
| 网关新能力发现 | [gateway-capability-discovery.md](gateway-capability-discovery.md) |

## 稳定模式 ID

| ID | 模式 |
|---|---|
| `PAT-SEM-01` | 事件、状态、查询、condition、register 与状态边沿语义 |
| `PAT-STATE-01` | 本规则状态、全局状态与跨规则契约 |
| `PAT-STATE-02` | 手动优先锁定与开灯来源追踪（自动开自动关，手动开常亮） |
| `PAT-NUM-01` | 数值规范化、函数和量程转换 |
| `PAT-AGG-01` | 多源聚合、偏差和至少满足 k 个 |
| `PAT-TIME-01` | 时间戳、时长、日期和长周期提醒 |
| `PAT-LOOP-01` | 可控循环、退出和设备状态恢复 |
| `PAT-SYNC-01` | 单向镜像、双向同步和防回环 |
| `PAT-ADAPT-01` | 输入适配、核心逻辑、输出适配和观测探针 |

## 设计检索顺序

1. 把需求拆成触发、状态、查询、变换、条件、动作、退出、恢复，并给关键边标记 `EVENT / STATE / QUERY`。
2. 如果存在“为什么只触发一次”“状态更新”“自定义状态”“查询会不会触发”“任一事件/任一条件”等语义问题，先读 `PAT-SEM-01`。
3. 再从上表选取一至三个业务模式文件。
4. 检查是否需要局部变量、全局变量、register，或完全不需要额外状态。
5. 读取目标设备 MIOT Spec，替换模式中的抽象属性和动作。
6. 处理初始化、UNKNOWN、离线、重复事件、并发和恢复。
7. 最后查节点参考，构造规则并执行双校验；静态通过后仍保留运行日志验证要求。

模式是设计起点，不是固定模板。可以组合、删减或拒绝模式；不得照抄案例中的设备、阈值、量程或私有标识。

## 来源与证据边界

- `sources/` 只回答“这个观点从哪里来”，不直接决定规则结构。
- `cases/` 保存脱敏后的实际解法与关联模式。
- `experiments/` 保存待验证命题和证据升级状态。
- `patterns/` 只接收已经抽象、边界明确的跨案例知识。
- 未达到相应证据等级的结论不得升级成强制 validator 规则。
