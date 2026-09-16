/**
 * Core - 规则工具
 */

import { GatewayClient } from '../gateway/client';
import { randomInt } from 'node:crypto';
import type { Graph, GraphSummary, CreateGraphInput, UpdateGraphInput, ValidationError } from '../types/graph';
import type { ToolResponse } from '../types';
import { validateGraph, layoutNodes, normalizeGraphNodeForWrite } from './base';
import { validateGraphCapabilitiesWithGateway } from './capabilityValidation';

function nextGraphId(): string {
    return String(randomInt(1_000_000_000_000, 10_000_000_000_000));
}

function replaceRuleScope(value: unknown, scope: string): unknown {
    if (Array.isArray(value)) return value.map((item) => replaceRuleScope(item, scope));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'scope' && item === 'rule' ? scope : replaceRuleScope(item, scope)]));
}

function comparableNodes(nodes: Graph['nodes']): unknown {
    return [...nodes].sort((left, right) => left.id.localeCompare(right.id)).map((node) => {
        const { pos: _pos, ...cfg } = node.cfg || {};
        return { ...node, cfg };
    });
}

function verifyUpdatedGraph(expected: Graph, actual: Graph): string | undefined {
    if (!actual || actual.id !== expected.id) return `回读规则 ID 不一致，期望 ${expected.id}`;
    if (actual.cfg?.enable !== expected.cfg.enable) {
        return `回读规则启用状态不一致，期望 ${expected.cfg.enable ? '启用' : '禁用'}`;
    }
    if (!Array.isArray(actual.nodes) || JSON.stringify(comparableNodes(actual.nodes)) !== JSON.stringify(comparableNodes(expected.nodes))) {
        return '回读规则节点与提交内容不一致';
    }
    return undefined;
}

function isSetupShell(graph: Graph): boolean {
    if (graph.cfg.enable !== false || graph.nodes.length !== 1) return false;
    const node = graph.nodes[0];
    return node.id === 'setup'
        && node.type === 'onLoad'
        && node.cfg?.name === 'onLoad'
        && Object.keys(node.props || {}).length === 0
        && Object.keys(node.inputs || {}).length === 0
        && JSON.stringify(node.outputs) === JSON.stringify({ output: [] });
}

function validateVariableDefinitions(variables: NonNullable<CreateGraphInput['variables']>): string | undefined {
    const ids = new Set<string>();
    for (const variable of variables) {
        if (!/^[a-zA-Z0-9]+$/.test(variable.id)) return `变量 ID ${variable.id} 必须是纯字母数字`;
        if (ids.has(variable.id)) return `变量 ID ${variable.id} 重复`;
        if (typeof variable.value !== variable.type) return `变量 ${variable.id} 的初始值类型必须是 ${variable.type}`;
        if (variable.name !== undefined && !variable.name.trim()) return `变量 ${variable.id} 的显示名称不能为空`;
        ids.add(variable.id);
    }
    return undefined;
}

async function deleteGraphConfirmed(gateway: GatewayClient, id: string): Promise<void> {
    try {
        await gateway.callApi('deleteGraph', { id }, 10000);
    } catch (deleteError) {
        const graphList = await gateway.callApi<Array<{ id: string }>>('getGraphList', {}, 10000);
        if (!Array.isArray(graphList) || graphList.some((graph) => graph.id === id)) throw deleteError;
    }
}

interface GraphListItem {
    id: string;
    enable?: boolean;
    userData?: {
        name?: string;
        lastUpdateTime?: number;
        transform?: {
            x: number;
            y: number;
            scale: number;
            rotate: number;
        };
    };
    createTime?: number;
}

export async function getGraphs(gateway: GatewayClient): Promise<ToolResponse<GraphSummary[]>> {
    try {
        const graphs = await gateway.callApi<GraphListItem[]>('getGraphList', {}, 10000);
        const graphList = Array.isArray(graphs) ? graphs : [];
        return {
            success: true,
            data: graphList.map((graph) => ({
                id: graph.id,
                name: graph.userData?.name || graph.id,
                enable: graph.enable !== false,
                createTime: graph.createTime,
                updateTime: graph.userData?.lastUpdateTime,
            })),
        };
    } catch (error) {
        return { success: false, error: `获取规则列表失败: ${error}` };
    }
}

export async function getGraph(gateway: GatewayClient, id: string): Promise<ToolResponse<Graph>> {
    try {
        const graph = await gateway.callApi<Graph>('getGraph', { id }, 10000);
        if (!graph.cfg) {
            const graphList = await gateway.callApi<Array<{
                id: string;
                enable?: boolean;
                userData?: Graph['cfg']['userData'];
            }>>('getGraphList', {}, 10000);
            const info = Array.isArray(graphList) ? graphList.find((item) => item.id === id) : undefined;
            graph.cfg = {
                id,
                enable: info?.enable ?? false,
                uiType: 'graph',
                userData: {
                    name: info?.userData?.name || id,
                    lastUpdateTime: info?.userData?.lastUpdateTime || 0,
                    transform: info?.userData?.transform || { x: 0, y: 0, scale: 1, rotate: 0 },
                },
            };
        }
        return { success: true, data: graph };
    } catch (error) {
        return { success: false, error: `获取规则详情失败: ${error}` };
    }
}

export async function createGraph(gateway: GatewayClient, input: CreateGraphInput): Promise<ToolResponse<{ graphId: string }>> {
    let graphId = input.graphId || nextGraphId();
    let variableScope = `R${graphId}`;
    const variables = input.variables || [];
    const createdVariables: string[] = [];
    let shellCreatedHere = false;
    let resumedExisting = false;
    try {
        const existingGraphs = await gateway.callApi<Array<{ id: string }>>('getGraphList', {}, 10000);
        const scopeResult = await gateway.callApi<{ scopes?: string[] } | string[]>('getVarScopeList', {}, 10000);
        const existingIds = new Set((Array.isArray(existingGraphs) ? existingGraphs : []).map((graph) => graph.id));
        const existingScopes = new Set(Array.isArray(scopeResult) ? scopeResult : scopeResult?.scopes || []);
        while (!input.graphId && (existingIds.has(graphId) || existingScopes.has(`R${graphId}`))) graphId = nextGraphId();
        variableScope = `R${graphId}`;
        const definitionError = validateVariableDefinitions(variables);
        if (definitionError) return { success: false, error: definitionError };

        const processedNodes = input.nodes.map((node) => normalizeGraphNodeForWrite({
            ...node,
            cfg: {
                ...node.cfg,
                name: (node.cfg as Record<string, unknown>)?.name || node.type,
                version: (node.cfg as Record<string, unknown>)?.version ?? 1,
            },
            props: replaceRuleScope(node.props || {}, variableScope) as Record<string, unknown>,
        }));

        layoutNodes(processedNodes);

        const graph = {
            id: graphId,
            nodes: processedNodes,
            cfg: {
                id: graphId,
                enable: input.enable ?? true,
                uiType: 'graph',
                userData: {
                    name: input.name,
                    lastUpdateTime: Date.now(),
                    transform: { x: 0, y: 0, scale: 1, rotate: 0 },
                },
            },
        };

        const errors = validateGraph(graph);
        const errorList = errors.filter((e: { level: string }) => e.level === 'error');
        if (errorList.length > 0) {
            return {
                success: false,
                error: `规则校验失败（${errorList.length} 个错误）：${errorList.map((item) => `[${item.nodeId}] ${item.message}`).join('；')}`,
            };
        }

        let resumedShell = false;
        if (input.graphId && existingIds.has(graphId)) {
            const existing = await gateway.callApi<Graph>('getGraph', { id: graphId }, 10000);
            if (JSON.stringify(comparableNodes(existing.nodes)) === JSON.stringify(comparableNodes(graph.nodes))) {
                resumedExisting = true;
            } else {
                resumedShell = isSetupShell(existing);
                if (!resumedShell) return { success: false, error: `指定的规则 ID ${graphId} 已被其他规则占用` };
                resumedExisting = true;
            }
        } else if (input.graphId && existingScopes.has(variableScope)) {
            return { success: false, error: `指定的规则作用域 ${variableScope} 已存在` };
        }

        if (variables.length > 0) {
            if (!resumedExisting) {
                shellCreatedHere = true;
                await gateway.callApi('setGraph', {
                    ...graph,
                    nodes: [{ id: 'setup', type: 'onLoad', cfg: { name: 'onLoad', version: 1 }, props: {}, inputs: {}, outputs: { output: [] } }],
                    cfg: { ...graph.cfg, enable: false },
                }, 10000);
            }
            const variableResponse = resumedExisting
                ? await gateway.callApi<Array<{ id?: string; type?: string }> | Record<string, { type?: string }>>('getVarList', { scope: variableScope }, 10000)
                : {};
            const existingVariables = new Map(Array.isArray(variableResponse)
                ? variableResponse.flatMap((variable) => typeof variable.id === 'string' ? [[variable.id, variable] as const] : [])
                : Object.entries(variableResponse || {}));
            for (const variable of variables) {
                const existingVariable = existingVariables.get(variable.id);
                if (existingVariable) {
                    if (existingVariable.type !== variable.type) throw new Error(`变量 ${variable.id} 类型与草稿不一致`);
                    continue;
                }
                createdVariables.push(variable.id);
                await gateway.callApi('createVar', {
                    scope: variableScope,
                    id: variable.id,
                    type: variable.type,
                    value: variable.value,
                    userData: { name: variable.name?.trim() || variable.id },
                }, 10000);
            }
        }
        const capabilityReport = await validateGraphCapabilitiesWithGateway(
            gateway,
            graph,
            input.durationRequirements ?? input.durationRequirement,
        );
        if (!capabilityReport.valid) throw new Error(`规则能力校验失败: ${capabilityReport.errors.map((item) => item.message).join('；')}`);

        if (!resumedExisting) shellCreatedHere = true;
        await gateway.callApi('setGraph', graph, 10000);

        return { success: true, data: { graphId }, message: `规则 "${input.name}" 创建成功` };
    } catch (error) {
        const cleanupErrors: string[] = [];
        if (shellCreatedHere) {
            try {
                await deleteGraphConfirmed(gateway, graphId);
                if (createdVariables.length > 0) await gateway.callApi('deleteVar', { scope: variableScope, all: true }, 10000);
            } catch (cleanupError) {
                cleanupErrors.push(`自动清理失败，可能残留规则 ${graphId} 或作用域 ${variableScope}: ${cleanupError}`);
            }
        } else if (createdVariables.length > 0) {
            for (const id of createdVariables) {
                try {
                    await gateway.callApi('deleteVar', { scope: variableScope, id }, 10000);
                } catch (cleanupError) {
                    cleanupErrors.push(`补建变量 ${variableScope}/${id} 清理失败: ${cleanupError}`);
                }
            }
        }
        return { success: false, error: `创建规则失败: ${error}${cleanupErrors.length ? `；${cleanupErrors.join('；')}` : ''}` };
    }
}

export async function updateGraph(gateway: GatewayClient, id: string, input: UpdateGraphInput): Promise<ToolResponse> {
    try {
        const existing = await gateway.callApi<Graph>('getGraph', { id }, 10000);
        const graphList = await gateway.callApi<GraphListItem[]>('getGraphList', {}, 10000);
        const graphInfo = Array.isArray(graphList)
            ? graphList.find((g) => g.id === id)
            : null;

        const inputNodes = input.nodes || existing.nodes;
        const processedNodes = inputNodes.map((node) => normalizeGraphNodeForWrite({
            ...node,
            cfg: {
                ...node.cfg,
                name: (node.cfg as Record<string, unknown>)?.name || node.type,
                version: (node.cfg as Record<string, unknown>)?.version ?? 1,
            },
            props: node.props || {},
        }));

        if (input.nodes) {
            const existingPositions = new Map(existing.nodes.flatMap((node) => {
                const pos = (node.cfg as Record<string, unknown>)?.pos;
                return pos && typeof pos === 'object' ? [[node.id, pos] as const] : [];
            }));
            const positions = new Map(processedNodes.flatMap((node) => {
                const pos = (node.cfg as Record<string, unknown>)?.pos;
                const preserved = pos && typeof pos === 'object' ? pos : existingPositions.get(node.id);
                return preserved ? [[node.id, preserved] as const] : [];
            }));
            layoutNodes(processedNodes);
            for (const node of processedNodes) {
                const pos = positions.get(node.id);
                if (pos) (node.cfg as Record<string, unknown>).pos = pos;
            }
        }

        const graph = {
            id,
            nodes: processedNodes,
            cfg: {
                id,
                enable: input.enable ?? graphInfo?.enable ?? existing.cfg?.enable ?? true,
                uiType: 'graph',
                userData: {
                    name: input.name || graphInfo?.userData?.name || existing.cfg?.userData?.name || '规则',
                    lastUpdateTime: Date.now(),
                    transform: graphInfo?.userData?.transform || existing.cfg?.userData?.transform || { x: 0, y: 0, scale: 1, rotate: 0 },
                },
            },
        };

        // 无论更新的是节点、名称还是启用状态，都校验完整候选图。
        // 空图通过只代表没有设备引用可检查，不能据此跳过真实候选图的校验。
        const errors = validateGraph(graph);
        const errorList = errors.filter((e: { level: string }) => e.level === 'error');
        if (errorList.length > 0) {
            return { success: false, error: `规则校验失败（${errorList.length} 个错误），请修复后重试` };
        }
        const capabilityReport = await validateGraphCapabilitiesWithGateway(
            gateway,
            graph,
            input.durationRequirements ?? input.durationRequirement,
        );
        if (!capabilityReport.valid) return { success: false, error: `规则能力校验失败: ${capabilityReport.errors.map((item) => item.message).join('；')}` };

        await gateway.callApi('setGraph', graph, 10000);

        const savedGraph = await gateway.callApi<Graph>('getGraph', { id }, 10000);
        const verificationError = verifyUpdatedGraph(graph, savedGraph);
        if (verificationError) {
            return { success: false, error: `规则已提交，但写入结果未确认：${verificationError}` };
        }

        return { success: true, data: { graphId: id }, message: `规则 ${id} 更新成功，已回读确认` };
    } catch (error) {
        return { success: false, error: `更新规则失败: ${error}` };
    }
}

export async function deleteGraph(gateway: GatewayClient, id: string): Promise<ToolResponse> {
    try {
        const scope = `R${id}`;
        const scopeResult = await gateway.callApi<{ scopes?: string[] } | string[]>('getVarScopeList', {}, 10000);
        const scopes = Array.isArray(scopeResult) ? scopeResult : scopeResult.scopes || [];
        const hasRuleVariables = scopes.includes(scope);
        await deleteGraphConfirmed(gateway, id);
        if (!hasRuleVariables) return { success: true, message: `规则 ${id} 删除成功` };
        try {
            await gateway.callApi('deleteVar', { scope, all: true }, 10000);
            return { success: true, message: `规则 ${id} 及本规则变量已删除` };
        } catch (cleanupError) {
            return { success: false, error: `规则 ${id} 已删除，但变量作用域 ${scope} 清理失败: ${cleanupError}` };
        }
    } catch (error) {
        return { success: false, error: `删除规则失败: ${error}` };
    }
}

export async function toggleGraph(gateway: GatewayClient, id: string, enable: boolean): Promise<ToolResponse> {
    try {
        const graphList = await gateway.callApi<GraphListItem[]>('getGraphList', {}, 10000);
        const graphInfo = Array.isArray(graphList)
            ? graphList.find((g) => g.id === id)
            : null;

        if (!graphInfo) {
            return { success: false, error: `规则 ${id} 不存在` };
        }

        await gateway.callApi('changeGraphConfig', {
            id,
            enable,
            userData: {
                name: graphInfo.userData?.name || '未命名规则',
                lastUpdateTime: Date.now(),
                transform: graphInfo.userData?.transform || { x: 0, y: 0, scale: 1, rotate: 0 },
            },
        }, 10000);

        return { success: true, message: `规则 ${id} 已${enable ? '启用' : '禁用'}` };
    } catch (error) {
        return { success: false, error: `切换规则状态失败: ${error}` };
    }
}
