import { z } from 'zod';
import type { GatewayClient } from '../gateway/client';
import type { ToolResponse } from '../types';
import type { DeviceUsage, DeviceUsageNode, DeviceUsageReport } from '../types/graph';

// Adapted from allocnode/oh-my-sage b2436fc (device reference scanning).
// Keep this read-only query separate from graph writes and their validation.
const DEVICE_NODE_ROLES = new Map<string, DeviceUsageNode['role']>([
    ['deviceInput', 'trigger'], ['deviceInputSetVar', 'trigger'],
    ['deviceGet', 'read'], ['deviceGetSetVar', 'read'], ['deviceOutput', 'write'],
]);
const SCAN_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

export const findDeviceUsageInputSchema = z.object({
    dids: z.array(z.string().trim().min(1)).max(100).optional().describe('设备 ID 数组；可查询设备列表中已不存在的 ID'),
    query: z.string().trim().min(1).max(200).optional().describe('按名称、型号、房间或设备 ID 模糊匹配'),
}).refine((input) => Boolean(input.dids?.length || input.query), {
    message: '必须提供非空的 dids 或 query；同时提供时取并集',
});

const deviceListSchema = z.object({
    devList: z.record(z.object({
        name: z.string().optional(),
        model: z.string().optional(),
        modelName: z.string().optional(),
        roomName: z.string().optional(),
    })),
});
const graphListSchema = z.array(z.object({
    id: z.string().trim().min(1),
    enable: z.boolean().optional(),
    userData: z.object({ name: z.string().optional() }).optional(),
})).refine((graphs) => new Set(graphs.map((graph) => graph.id)).size === graphs.length);
const graphSchema = z.object({
    id: z.string().optional(),
    cfg: z.object({ enable: z.boolean().optional() }).optional(),
    nodes: z.array(z.object({
        id: z.string().min(1),
        type: z.string().min(1),
        props: z.record(z.unknown()),
    })).superRefine((nodes, ctx) => {
        for (const node of nodes) {
            if (DEVICE_NODE_ROLES.has(node.type)
                && (typeof node.props.did !== 'string' || !node.props.did.trim())) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: '设备节点缺少有效的设备 ID' });
            }
        }
    }),
});

function nodeTarget(props: Record<string, unknown>): string {
    return ['siid', 'piid', 'eiid', 'aiid']
        .filter((key) => typeof props[key] === 'number' && Number.isFinite(props[key]))
        .map((key) => `${key}=${String(props[key])}`).join(' ') || '-';
}

/**
 * 只读取设备列表和规则快照，不控制设备、不写规则、不访问公网。
 * 单次请求最多 10 秒，整次扫描最多等待 30 秒；取消后不再发起新请求。
 * 空值、畸形响应和未读取的规则不等价于“没有引用”。
 */
export async function findDeviceUsage(
    gateway: Pick<GatewayClient, 'callApi'>,
    input: unknown,
    options: { signal?: AbortSignal } = {},
): Promise<ToolResponse<DeviceUsageReport>> {
    const parsedInput = findDeviceUsageInputSchema.safeParse(input);
    if (!parsedInput.success) return { success: false, error: '必须提供有效的 dids 或 query：最多 100 个非空设备 ID，查询文字最长 200 字' };
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    const canContinue = () => !options.signal?.aborted && Date.now() < deadline;
    const read = (method: string, params: Record<string, unknown> = {}) => {
        if (!canContinue()) throw new Error('scan stopped');
        return gateway.callApi<unknown>(method, params, Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())));
    };

    let rawDevices: unknown;
    try {
        rawDevices = await read('getDevList');
    } catch {
        return { success: false, error: '设备列表读取失败、扫描超时或已取消，无法确认设备引用' };
    }
    const deviceResponse = deviceListSchema.safeParse(rawDevices);
    if (!deviceResponse.success) return { success: false, error: '设备列表格式异常，无法确认设备引用' };
    const devices = new Map(Object.entries(deviceResponse.data.devList));
    const targets = new Set(parsedInput.data.dids || []);
    const query = parsedInput.data.query?.toLowerCase();
    if (query) {
        for (const [did, device] of devices) {
            const haystack = [did, device.name, device.model, device.modelName, device.roomName].join(' ').toLowerCase();
            if (haystack.includes(query)) targets.add(did);
        }
    }
    if (targets.size === 0) return { success: false, error: '没有匹配的设备，请使用 get_devices 确认名称，或提供已知设备 ID 排查残留引用' };

    let rawGraphs: unknown;
    try {
        rawGraphs = await read('getGraphList');
    } catch {
        return { success: false, error: '规则列表读取失败、扫描超时或已取消，无法确认设备引用' };
    }
    const graphList = graphListSchema.safeParse(rawGraphs);
    if (!graphList.success) return { success: false, error: '规则列表格式异常，无法确认设备引用' };

    const hits = new Map<string, DeviceUsage>();
    for (const did of targets) {
        hits.set(did, {
            did, name: devices.get(did)?.name || '(设备名称未知)', found: devices.has(did), nodeCount: 0, graphs: [],
        });
    }
    const orphans = new Map<string, Set<string>>();
    const report: DeviceUsageReport = {
        devices: [], orphans: [], totalGraphs: graphList.data.length, scannedGraphs: 0,
        unreadableGraphs: [], skippedGraphs: [], complete: true,
    };
    for (const summary of graphList.data) {
        if (!canContinue()) {
            report.skippedGraphs.push(summary.id);
            continue;
        }
        report.scannedGraphs++;
        let rawGraph: unknown;
        try {
            rawGraph = await read('getGraph', { id: summary.id });
        } catch {
            report.unreadableGraphs.push(summary.id);
            continue;
        }
        const graph = graphSchema.safeParse(rawGraph);
        if (!graph.success || (graph.data.id !== undefined && graph.data.id !== summary.id)) {
            report.unreadableGraphs.push(summary.id);
            continue;
        }
        const graphName = summary.userData?.name || summary.id;
        const perDevice = new Map<string, DeviceUsageNode[]>();
        for (const node of graph.data.nodes) {
            const role = DEVICE_NODE_ROLES.get(node.type);
            const did = node.props.did;
            if (!role || typeof did !== 'string') continue;
            if (!devices.has(did)) {
                const names = orphans.get(did) || new Set<string>();
                names.add(graphName);
                orphans.set(did, names);
            }
            if (!hits.has(did)) continue;
            const nodes = perDevice.get(did) || [];
            nodes.push({ nodeId: node.id, nodeType: node.type, role, target: nodeTarget(node.props) });
            perDevice.set(did, nodes);
        }
        for (const [did, nodes] of perDevice) {
            const usage = hits.get(did);
            if (!usage) continue;
            usage.nodeCount += nodes.length;
            usage.graphs.push({
                graphId: summary.id, name: graphName,
                enable: summary.enable ?? graph.data.cfg?.enable ?? null, nodes,
            });
        }
    }
    report.devices = [...hits.values()].sort((a, b) => b.nodeCount - a.nodeCount);
    report.orphans = [...orphans].map(([did, graphs]) => ({ did, graphs: [...graphs] }));
    report.complete = report.unreadableGraphs.length === 0 && report.skippedGraphs.length === 0;
    return {
        success: true,
        data: report,
        message: report.complete
            ? '设备引用扫描完成；结果仅表示规则快照中的直接引用，不代表规则已执行或设备实时状态'
            : '设备引用扫描不完整：部分规则读取失败、格式异常或尚未读取，不能据此断言设备没有被引用',
    };
}
