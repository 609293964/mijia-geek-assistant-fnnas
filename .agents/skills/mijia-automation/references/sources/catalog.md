# 公开知识来源目录

本目录只保存可公开访问、可追溯的教程来源与提炼状态，不复制完整字幕、截图、家庭设备数据或作者私有内容。

## 使用原则

公开教程只能提供设计线索，不能直接升级成网关硬规则。知识进入运行时前按以下路径处理：

```text
公开来源 source
  → 脱敏案例 case
  → 待验证命题 experiment
  → 网关源码 / MIoT / 图差异 / 实机验证
  → 可复用模式 pattern
  → 必要时才进入 validator
```

- `video` 仅表示来源已确认，不表示行为已被网关实测。
- 只有达到 `runtime-verified` 且边界明确的结论，才允许升级为通用推荐模式。
- 单一作者经验、设备私有枚举、固定阈值和家庭习惯不得直接泛化。
- 页面标题、合集顺序和平台 AI 文稿可能后续变化；以来源 ID 与 URL 为追溯主键。

## 易举不易：底层语义系列

| 来源 ID | 主题 | URL | 当前用途 |
|---|---|---|---|
| `SRC-BILI-EASY-SERIES` | 米家极客版系列总入口，覆盖基础逻辑、日志、设备/时间/流程/逻辑卡片、变量、属性探测、状态更新 | https://www.bilibili.com/video/BV1wM411k7g6/ | 语义课程索引，`video` |
| `SRC-BILI-EASY-BASIC` | 基础逻辑：为什么规则不执行、事件如何推动流程 | https://www.bilibili.com/video/BV1yM411c7nR/ | `PAT-SEM-01` 候选证据 |
| `SRC-BILI-EASY-LOGIC` | 逻辑卡片、自定义状态与“为什么只能用一次” | https://www.bilibili.com/video/BV1je411S7vf/ | register/状态边沿候选证据 |
| `SRC-BILI-EASY-EDGE` | 状态更新卡片的包含触发逻辑；原始值变化与谓词真假变化的区别 | https://www.bilibili.com/video/BV1by411B7Bs/ | `PAT-SEM-01` 重要候选证据 |

## 我是你八哥啊：复杂自动化设计案例

| 来源 ID | 主题 | URL | 当前用途 |
|---|---|---|---|
| `SRC-BILI-BUG-SERIES` | 米家自动化极客版全系列合集 | https://space.bilibili.com/592162578/lists/1295296?type=season | 案例索引，`video` |
| `SRC-BILI-BUG-STATE` | 自定义状态卡详细解说 | https://www.bilibili.com/video/BV1s94y147fF/ | 状态锁存、初始化、重新武装候选 |
| `SRC-BILI-BUG-OCC` | 人体传感器模拟持续有人 | https://www.bilibili.com/video/BV1Go4y1i7rG/ | 占用状态案例，`video` |
| `SRC-BILI-BUG-MANUAL` | 手动与自动调光兼顾 | https://www.bilibili.com/video/BV1GM411a7F5/ | 手动优先/来源追踪案例 |
| `SRC-BILI-BUG-MODE` | 模式切换卡片归位 | https://www.bilibili.com/video/BV1WG4y1j7af/ | 外部改档与内部游标失配案例 |
| `SRC-BILI-BUG-STATE-DRIVEN` | 另一种模式切换接线方案 | https://www.bilibili.com/video/BV1kk4y1Y7LA/ | 真实设备状态驱动下一动作案例 |
| `SRC-BILI-BUG-DELAY` | 延时的打断 | https://www.bilibili.com/video/BV1Tm4y1K7VJ/ | 延时/重入候选实验 |
| `SRC-BILI-BUG-VIRTUAL` | 用虚拟事件生成虚拟状态 | https://www.bilibili.com/video/BV1nm4y1k78U/ | 虚拟事件与状态适配案例 |
| `SRC-BILI-BUG-COUNT` | 达到指定次数卡片实用演示 | https://www.bilibili.com/video/BV1PW4y1572F/ | 计数与复位案例 |
| `SRC-BILI-BUG-LOCK-ID` | 获取智能门锁操作 ID | https://www.bilibili.com/video/BV1e94y167Ed/ | 观测探针案例；人员数据仅保留脱敏结论 |

## 抖音公开 AI 文稿补充

| 来源 ID | 主题 | URL | 当前用途 |
|---|---|---|---|
| `SRC-DY-BUG-REGISTER` | 寄存器的定义、可读可写与断电记忆要求 | https://www.douyin.com/shipin/7304332544962201650 | 区分“物理寄存器 / register / 变量”，`video` |
| `SRC-DY-BUG-PRELOAD` | 停电恢复后设备状态上报与“规则启动时查询一次” | https://www.douyin.com/shipin/7448426657234438170 | 启动恢复/未知状态候选证据 |

## 用户提供的视频样本（待公开溯源）

以下样本来自用户直接提供的视频文件。仓库只保存脱敏后的方法摘要，不保存原视频、完整转写或家庭数据；在补到公开 URL 前，它们只能作为 `user-provided` 级设计线索，不能视为公开可复现证据。

| 来源 ID | 主题 | URL | 当前用途 |
|---|---|---|---|
| `SRC-UPLOAD-ARB-001` | 变量分流的优先级仲裁：把多个互相牵制的业务条件拆成独立意图组，用优先级变量统一仲裁最终开/关命令 | 待补 | 多意图竞争、变量生命周期、平票/并发/UNKNOWN 的候选架构 |
| `SRC-UPLOAD-NOTIFY-001` | 自动化触发后的手机通知：首尾虚拟事件通知，以及“执行中变量 + 延时查询”的流程完成检测 | 待补 | 执行反馈、流程完成看门狗、设备最终状态验证的候选案例 |

## 待解析来源

| 来源 ID | URL | 状态 |
|---|---|---|
| `SRC-BILI-PENDING-001` | https://www.bilibili.com/video/BV1EdYgzhEw9/ | 当前公开搜索未稳定返回标题/正文；不从该来源导入任何行为结论 |

## 与仓库知识层的映射

- 事件、状态、查询、边沿：`../patterns/event-state-semantics.md`
- 状态、变量、手动优先：`../patterns/state-and-scope.md`
- 模式归位与真实状态驱动：`../patterns/synchronization.md`、`../patterns/loops-and-lifecycle.md`
- 占用持续与时间：`../patterns/time-and-duration.md`
- 虚拟事件、观测探针：`../patterns/adapters-and-templates.md`
- 视频案例的脱敏关联：`../cases/catalog.md`
- 尚未完成实机确认的命题：`../experiments/index.md`
