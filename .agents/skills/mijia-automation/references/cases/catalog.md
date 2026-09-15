# 案例关联索引

本文件只保存脱敏关联，不复制视频口述、截图、家庭设备或私有路径。

| 案例组 | 关联模式 | 当前状态 | 关联原语证据与主要边界 |
|---|---|---|---|
| 属性与参数同步 | state-and-scope, numeric-transforms, synchronization | video | 动态参数原语已有运行证据；量程、步进、回环仍需整案验证 |
| 温度与环境播报 | state-and-scope, numeric-transforms | video | 数值和文本原语已有运行证据；初始化、新鲜度、尾零未整案验证 |
| 多传感器最值和偏差 | aggregation-and-thresholds | video | 更新时序、错误变量引用 |
| 随机设备参数 | loops-and-lifecycle, numeric-transforms | video | 随机和 loop 原语已有运行证据；设备编码、停止后状态未整案验证 |
| 单次及累计时长 | time-and-duration | video | 时间函数原语已有运行证据；重启、重复事件、分段边界未整案验证 |
| 长周期提醒 | time-and-duration, state-and-scope | video | 起点语义、确认事件 |
| 全局状态与部分条件 | state-and-scope, aggregation-and-thresholds | video | 初值、异常枚举、消费者依赖 |
| 双向同步 | synchronization | video | 设备输入和动态输出原语已有运行证据；并发、容差、离线恢复未整案验证 |
| 变量化模板 | adapters-and-templates | video | scope、设备重绑、复杂度收益 |
| 事件参数发现 | adapters-and-templates | private-only | 隐私、型号差异、重复验证 |
| 日期与动态时间段 | time-and-duration, state-and-scope | video | 日期函数原语已有运行证据；时区、错过边界、恢复未整案验证 |
| 查询值新鲜度与未知状态 | event-state-semantics, state-and-scope, adapters-and-templates | video | 断电后可能仍命中最近上报值；离线、未知和固件差异待独立实测 |
| 触发、状态、否则与互为状态 | event-state-semantics, state-and-scope, aggregation-and-thresholds | runtime-verified | 已实测事件不回补及 false 走 unmet；未知值和互为状态整案待验证 |
| 虚拟事件通知闭环 | adapters-and-templates, loops-and-lifecycle | runtime-verified | 规则产生和消费已实测；App 创建、通知往返和重复触发待验证 |
| 模式游标与外部状态不同步 | synchronization, loops-and-lifecycle | video | 状态查询链优先；旧值、异常档位和补脉冲风险待验证 |
| 空触点与枚举多选 | aggregation-and-thresholds, adapters-and-templates | runtime-verified | modeSwitch 空档占轮次已实测；逻辑空输入、集合边沿和重启持久性待验证 |
| 节律照明与动态窗口 | time-and-duration, numeric-transforms, loops-and-lifecycle | runtime-verified, conflicted | 日期时间函数和 min 夹紧已实测；初始化、跨段和跨天恢复缺失 |
| 语音主动询问与应答分发 | state-and-scope, adapters-and-templates, aggregation-and-thresholds | video | 单入口配合时间窗寄存器分发多问；窗口重叠、求值顺序、语音到事件时延和 MCP 侧建入口均未验证 |

## 公开教程案例映射

这些条目用于把公开教程与模式/实验关联起来。它们仍是 `video` 级案例，不能因为来源讲解清楚就直接升级为强制规则。

| 案例组 | 主要来源 | 关联模式 | 当前状态 | 需要继续验证的边界 |
|---|---|---|---|---|
| 事件、状态、查询与状态更新边沿 | `SRC-BILI-EASY-BASIC`, `SRC-BILI-EASY-LOGIC`, `SRC-BILI-EASY-EDGE` | `PAT-SEM-01` | video | 不同节点/固件的边沿触发、一致值重复上报、UNKNOWN |
| 自定义状态锁存与重新武装 | `SRC-BILI-BUG-STATE`, `SRC-BILI-EASY-LOGIC` | `PAT-SEM-01`, `PAT-STATE-01` | video | register 重启初值、重复 setTrue/setFalse、并发置位 |
| 人体事件模拟持续有人 | `SRC-BILI-BUG-OCC` | `PAT-STATE-01`, `PAT-TIME-01` | video | 快速进出、重复上报、网关重启、无人事件丢失 |
| 人工操作优先于自动灯光 | `SRC-BILI-BUG-MANUAL` | `PAT-STATE-02`, `PAT-TIME-01`, `PAT-SYNC-01` | video | 手动开/关来源识别、App/语音操作、状态回传延迟 |
| 模式切换归位与状态驱动下一档 | `SRC-BILI-BUG-MODE`, `SRC-BILI-BUG-STATE-DRIVEN` | `PAT-SYNC-01`, `PAT-LOOP-01` | video | App 外部改档后立即查询、旧值、异常档位、重启游标 |
| 延时重入与打断 | `SRC-BILI-BUG-DELAY` | `PAT-TIME-01`, `PAT-LOOP-01` | video | 同一延时重复触发时的重入/打断精确语义仍需实验 |
| 虚拟事件转业务状态 | `SRC-BILI-BUG-VIRTUAL` | `PAT-ADAPT-01`, `PAT-STATE-01` | video | App 入口创建已是外部前置；网关侧事件生产/消费已有部分运行证据 |
| 计数、达到指定次数与复位 | `SRC-BILI-BUG-COUNT` | `PAT-LOOP-01` | video | onlyNTimes/counter 的并发、zero 时序、重启状态 |
| 未知 ID / 枚举观测探针 | `SRC-BILI-BUG-LOCK-ID` | `PAT-ADAPT-01` | video, private-only | 人员/门锁数据不得公开；不同型号 ID 不能复用 |
| 物理寄存器与持久状态 | `SRC-DY-BUG-REGISTER` | `PAT-STATE-01`, `PAT-ADAPT-01` | video | “断电记忆”属于具体设备能力，必须逐设备实测，不能泛化到 register/变量 |
| 启动查询与停电恢复 | `SRC-DY-BUG-PRELOAD` | `PAT-SEM-01`, `PAT-STATE-01`, `PAT-LOOP-01` | video | preload/onLoad 与设备上线时序、陈旧缓存和人工恢复竞争 |

来源 URL 与提炼状态见 `../sources/catalog.md`。

完整案例证据由维护者保存在私有案例库。公开模式只接收经过脱敏和验证的结论。
