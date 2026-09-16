/**
 * Core - 规则类型定义
 */

/** 规则节点 */
export interface GraphNode {
    id: string;
    type: string;
    cfg: Record<string, unknown>;
    props: Record<string, unknown>;
    inputs: Record<string, unknown>;
    outputs: Record<string, string[]>;
}

/** 规则配置 */
export interface GraphConfig {
    id: string;
    enable: boolean;
    uiType: string;
    userData: {
        name: string;
        lastUpdateTime: number;
        transform: {
            x: number;
            y: number;
            scale: number;
            rotate: number;
        };
    };
}

/** 规则 */
export interface Graph {
    id: string;
    nodes: GraphNode[];
    cfg: GraphConfig;
    durationRequirement?: DurationRequirement;
    durationRequirements?: DurationRequirement[];
}

/** 规则摘要 */
export interface GraphSummary {
    id: string;
    name: string;
    enable: boolean;
    createTime?: number;
    updateTime?: number;
}

/** 创建规则输入 */
export interface CreateGraphInput {
    graphId?: string;
    name: string;
    nodes: GraphNode[];
    enable?: boolean;
    variables?: Array<{
        id: string;
        type: 'number' | 'string';
        value: number | string;
        name?: string;
    }>;
    durationRequirement?: DurationRequirement;
    durationRequirements?: DurationRequirement[];
}

export interface DurationRequirement {
    durationMs: number;
    intent: 'state_hold' | 'action_delay';
    hardRequirement?: boolean;
    targetDids?: string[];
    /** 绑定到具体的持续/延时节点，避免一条全局时长误覆盖多个分支。 */
    nodeId?: string;
    /** 可选的状态来源节点，用于校验关键路径没有接错分支。 */
    sourceNodeId?: string;
    sourceDid?: string;
    sourceOperator?: string;
    sourceValues?: Array<string | number | boolean>;
}

export type UpdateGraphInput = Partial<Pick<CreateGraphInput, 'name' | 'nodes' | 'enable' | 'durationRequirement' | 'durationRequirements'>>;

/** 校验错误 */
export interface ValidationError {
    nodeId: string;
    type: string;
    level: 'error' | 'warn';
    message: string;
}

/** 设备在某个节点上的直接引用，角色沿用上游的 trigger/read/write 分类。 */
export interface DeviceUsageNode {
    nodeId: string;
    nodeType: string;
    role: 'trigger' | 'read' | 'write';
    target: string;
}

export interface DeviceUsageGraph {
    graphId: string;
    name: string;
    /** 元数据未给出启用状态时保持未知，不能误报为禁用。 */
    enable: boolean | null;
    nodes: DeviceUsageNode[];
}

export interface DeviceUsage {
    did: string;
    name: string;
    /** 是否存在于此次设备列表，不代表设备在线或已确认删除。 */
    found: boolean;
    nodeCount: number;
    graphs: DeviceUsageGraph[];
}

export interface DeviceUsageReport {
    devices: DeviceUsage[];
    orphans: Array<{ did: string; graphs: string[] }>;
    totalGraphs: number;
    /** 已尝试读取的规则数，包含 unreadableGraphs。 */
    scannedGraphs: number;
    unreadableGraphs: string[];
    /** 到达总时限或取消后尚未读取的规则。 */
    skippedGraphs: string[];
    complete: boolean;
}
