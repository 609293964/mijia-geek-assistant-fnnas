# 实验索引与证据状态

## 状态机

```text
video
→ ui-sample
→ graph-diff
→ local-tested
→ gateway-roundtrip
→ runtime-verified
→ reusable-pattern
```

终止或限制状态：

- `conflicted`：来源内部矛盾，等待新证据。
- `rejected`：实验证明不成立。
- `private-only`：含家庭、门锁、人员或网络敏感信息。

状态只能凭证据向前升级。状态表示当前最高证据，不要求所有项目都从 `video` 开始；不适用步骤可记为 N/A。静态双校验不能替代运行验证；单次成功不能证明边界和跨设备通用性。`reusable-pattern` 还必须满足脱敏、跨场景适用和边界明确。

## 实验记录最小字段

- 实验 ID 和关联案例/模式 ID。
- 目标与预期行为。
- 来源与当前状态。
- 变量、节点角色和关键连接。
- UI 样本和规则 diff。
- 本地测试、网关回读和实机结果。
- 清理记录。
- 冲突、失败和适用边界。
- 隐私等级。

项目仓库只保存脱敏、可公开、可复现的实验。家庭级原始证据保留在私有案例库。

## 当前待验证主题

| 主题 | 当前状态 | 最小验证 |
|---|---|---|
| `deviceGet` 新鲜度 | video | 正常上报、刚断电、已离线、从未上报四种状态下记录两分支和日志 |
| trigger / condition / else 时序 | runtime-verified | 已确认先事件后状态不回补、false 走 unmet；未知状态仍需验证 |
| 空输入与空输出 | runtime-verified | 已确认 modeSwitch 空输出占用轮次；logicAnd、logicOr、signalOr 空输入仍待验证 |
| 枚举多选集合 | video | 执行集合外→内、集合内切换、离开后再进入，记录触发次数和真实图 JSON |
| 模式游标与状态查询链 | video | App 外部改档后立即/延迟触发，比较查询值、下一动作和异常兜底 |
| 虚拟事件协同 | runtime-verified | 已确认网关规则可产生并消费同名字符串事件；App 创建、通知往返及重复触发仍待验证 |
| 启动恢复动作 | video, conflicted | 用无害灯记录规则启用、设备上线、延迟动作和人工操作竞争的时间线 |
| 节律渐变 | video, conflicted | 三分钟短区间验证初始化、步长、终点夹紧、中途关灯、重启和停止 |
| register 上升沿与重复置位 | video | 用临时计数变量记录 false→true、true→true、true→false 三种序列的 output 次数；关联 `SRC-BILI-BUG-STATE`、`SRC-BILI-EASY-LOGIC` |
| 状态谓词真值边沿与原始值更新 | video | 选一个多值属性，分别测试“原始值变化但谓词仍 true”“false→true”“true→false”，记录实际事件次数；关联 `SRC-BILI-EASY-EDGE` |
| 人体事件模拟持续有人 | video | 用无害反馈验证重复有人、无人复位、快速进出、网关重启四条路径；关联 `SRC-BILI-BUG-OCC` |
| 手动优先自动灯控 | video | 覆盖实体按键、App、语音、自动化四种开灯来源，验证自动关灯是否只作用于自动开启来源；关联 `SRC-BILI-BUG-MANUAL` |
| delay 重入与打断 | video | 在同一 delay 未结束前再次触发，记录旧计时是否继续、重置、并行或被打断；再加入取消路径；关联 `SRC-BILI-BUG-DELAY` |
| 计数节点 zero 与重启 | video | 分别验证 onlyNTimes/counter 的第 N 次输出、zero 立即复位、并发输入以及规则重启后的计数状态；关联 `SRC-BILI-BUG-COUNT` |
| preload / 启动时查询一次 | video | 停电恢复后分别测试 preload 开/关、设备先上线/后上线、状态未变化三种时序，记录中枢得到首个有效状态的时间；关联 `SRC-DY-BUG-PRELOAD` |
| 物理寄存器断电记忆 | video | 对每个候选设备属性单独验证：可写、可读、不影响主功能、断电后值保留；不得把一个型号结果泛化到其他设备；关联 `SRC-DY-BUG-REGISTER` |
| 多意图优先级仲裁的复位与平票 | user-provided | 建立至少 3 个独立开/关意图，分别验证条件成立写优先级、条件失效归零、开关同优先级、全部为 0、UNKNOWN；确认仲裁结果不会保留幽灵高优先级；关联 `SRC-UPLOAD-ARB-001` |
| 多意图同时更新的中间态 | user-provided | 让两个相反意图近同时改变，记录变量更新顺序、仲裁次数、目标设备是否产生瞬态开关；评估是否需要合并/去抖或单一重算入口；关联 `SRC-UPLOAD-ARB-001` |
| 仲裁结果与真实设备状态收敛 | user-provided | 仲裁得到最终命令后先查询目标当前状态，仅在不一致时写入；测试 App/语音外部改状态、设备离线和恢复；关联 `SRC-UPLOAD-ARB-001` |
| 首尾虚拟事件手机通知 | user-provided | 用无害规则验证开始事件、末尾事件分别到达 App 通知链路的次数和时延；明确末尾事件只证明流程到达末尾，不证明设备最终状态；关联 `SRC-UPLOAD-NOTIFY-001` |
| 执行中变量 + 超时完成检测 | user-provided | 触发时置运行标记，末尾清除，并行延时后查询；覆盖正常完成、超时、流程中途停止、重复触发/重入，确认不同执行实例是否互相污染；关联 `SRC-UPLOAD-NOTIFY-001` |
| 流程完成与设备最终状态分离 | user-provided | 对可读回状态设备执行动作后，分别记录“流程到末尾”和“设备达到目标状态”的时间；测试离线、拒绝命令、回报延迟，禁止把两者合并为同一成功条件；关联 `SRC-UPLOAD-NOTIFY-001` |
| 完成检测超时阈值 | user-provided | 对本地灯、云端设备、窗帘等不同执行时长统计完成与状态回报延迟；证明固定 3 秒只能是案例参数，不能进入通用模板；关联 `SRC-UPLOAD-NOTIFY-001` |

## 已验证命题

验证批次：`EXP-20260726-01`，当前中枢网关，临时规则创建、回读变量、删除规则及变量后确认无残留。

| 命题 | 状态 | 本轮结果 | 未覆盖边界 |
|---|---|---|---|
| `month()` 可在规则运行时返回月份 | runtime-verified | 返回 `7` | 时区、跨月 |
| `hours()` 可在规则运行时返回小时 | runtime-verified | 返回 `17` | 时区、夏令时 |
| `min()` 可夹紧渐变终点 | runtime-verified | 超调表达式被夹紧为 `25` | 下降段、设备步进 |
| `deviceGet` 按比较结果走双分支 | runtime-verified | 当前开关命中满足分支 | 离线、未知、旧值时长 |
| 事件先到、状态稍后变真不会回补 | runtime-verified | 事件早约 500 ms，`met` 未执行 | 不同状态源、固件 |
| 条件为 false 时执行 `unmet` | runtime-verified | `unmet` 分支执行一次 | 未知值 |
| counter 可在第 3 轮停止 loop | runtime-verified | 循环变量最终为 `3` | 重启、并发启动 |
| modeSwitch 空输出仍占一个轮次 | runtime-verified | A、B 各执行一次，第三空档终止链 | 重启后游标 |
| 网关虚拟事件可由规则产生并消费 | runtime-verified | 同名字符串事件被消费一次 | App 通知、重复触发、跨规则重启 |

## 公开来源

来源 URL、作者与主题统一维护在 `../sources/catalog.md`。实验记录只引用稳定的 `SRC-*` ID，避免把平台页面文本复制进仓库。
