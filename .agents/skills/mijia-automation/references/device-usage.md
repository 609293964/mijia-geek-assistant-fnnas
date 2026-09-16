# 设备引用扫描

来源：[上游 PR #21](https://github.com/allocnode/oh-my-sage/pull/21)，核心提交 `b2436fc`。飞牛版 0.0.9 将其适配为网页工具 `find_device_usage`，保留现有 Web Agent 和 fnOS Native 结构。

## 输入与范围

- `dids`：最多 100 个非空设备 ID；可以查询已经不在设备列表里的已知 ID。
- `query`：最长 200 字，按设备名称、型号、中文型号名、房间、ID 模糊匹配，不区分大小写。
- 至少提供一项，同时提供则合并匹配结果并去重。
- 只调用 `getDevList`、`getGraphList`、`getGraph`，不控制设备、不写规则、不读取日志，也不向公网查询 MIOT Spec。
- 扫描全部规则中的直接引用：`deviceInput`、`deviceInputSetVar` 为 trigger；`deviceGet`、`deviceGetSetVar` 为 read；`deviceOutput` 为 write。

## 返回结果

工具沿用 `success/data/message` 响应；输入或全局列表异常时返回 `success=false` 和脱敏中文错误。

| data 字段 | 含义 |
|---|---|
| `devices` | 匹配设备及其规则、节点、角色和 SIID/PIID/EIID/AIID |
| `orphans` | 在已成功读取的全部规则中，引用了但此次设备列表中不存在的设备及规则名 |
| `totalGraphs` | 规则列表中的总数 |
| `scannedGraphs` | 已尝试读取的规则数，包含读取失败的规则 |
| `unreadableGraphs` | 请求失败、缺失 nodes、节点格式异常或返回规则 ID 不符的规则 |
| `skippedGraphs` | 总时限到达或取消后尚未读取的规则 |
| `complete` | 只有全部规则读取与解析成功时才为 true |

规则的 `enable` 为 true/false/null，null 表示启用状态未知。设备的 `found` 仅表示是否存在于此次设备列表，不等于在线状态，也不确认物理设备已被删除。

## 不完整扫描与证据边界

每次请求最多 10 秒，整次扫描的请求等待预算为 30 秒；临近总时限会缩短请求超时。取消后不再发起新请求，已发出的请求由网关客户端按超时结束。

- `complete=false` 时先说明扫描不完整。零命中只能表示“已读取的规则中未发现引用”，不得宣称没有引用或可以安全删除。
- 不自动反复重试扫描；规则很多时可根据未确认列表继续定向排查。
- 扫描是顺序读取的快照，期间规则可能变化；不构成原子快照。
- 只覆盖上述五类节点的直接引用，不追踪变量/虚拟事件等间接依赖，不证明规则实际执行过。
- 证据等级：上游代码与本地 mock 回归测试；未完成真实 fnOS/网关运行验证。
