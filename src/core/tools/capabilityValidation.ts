import { GatewayClient } from '../gateway/client';
import type { DeviceListResponse, MiotActionCapability, MiotEventCapability, MiotPropertyCapability } from '../types/device';
import type { DurationRequirement, Graph, GraphNode, ValidationError } from '../types/graph';
import type { Variable } from '../types';
import { normalizeMiotSpec } from './device';

export interface DeviceCapabilities {
    urn: string;
    properties: MiotPropertyCapability[];
    events: MiotEventCapability[];
    actions: MiotActionCapability[];
}

export interface CapabilityValidationReport {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
    inspectedDids: string[];
    inspectedUrns: string[];
}

function durationUnitMs(unit?: string): number | undefined {
    if (!unit) return undefined;
    const normalized = unit.toLowerCase();
    if (normalized === 'ms' || normalized === 'millisecond' || normalized === 'milliseconds') return 1;
    if (normalized === 's' || normalized === 'second' || normalized === 'seconds') return 1000;
    if (normalized === 'min' || normalized === 'minute' || normalized === 'minutes') return 60000;
    if (normalized === 'h' || normalized === 'hour' || normalized === 'hours') return 3600000;
    return undefined;
}

function isDurationProperty(property: MiotPropertyCapability): boolean {
    const text = `${property.desc} ${property.unit || ''}`.toLowerCase();
    return /duration|timeout|持续|时长|无动作|无人|no_motion|delay/.test(text)
        && durationUnitMs(property.unit) !== undefined;
}

function representableDuration(property: MiotPropertyCapability, durationMs: number): boolean {
    const unit = durationUnitMs(property.unit);
    if (!unit) return false;
    const value = durationMs / unit;
    if (!Number.isInteger(value)) return false;
    if (property.list) return property.list.some((item) => item.value === value);
    if (property.range) return value >= property.range.min && value <= property.range.max
        && ((value - property.range.min) % property.range.step === 0);
    return true;
}

function nativeDurationDescription(property: MiotPropertyCapability): string {
    const limits = property.list
        ? `可选值 ${JSON.stringify(property.list.map((item) => item.value))}`
        : property.range
            ? `范围 ${JSON.stringify(property.range)}`
            : '无枚举/范围信息';
    return `${property.desc} (siid=${property.siid}, piid=${property.piid}, unit=${property.unit}, ${limits}, access=${property.access.join(',') || '未知'})`;
}

function durationRequirementsList(requirement?: DurationRequirement | DurationRequirement[]): DurationRequirement[] {
    if (!requirement) return [];
    return Array.isArray(requirement) ? requirement : [requirement];
}

function graphHasPath(nodes: GraphNode[], fromId: string, toId: string): boolean {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const visited = new Set<string>();
    const queue = [fromId];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === toId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        const node = nodeMap.get(current);
        if (!node) continue;
        for (const targets of Object.values(node.outputs || {})) {
            if (!Array.isArray(targets)) continue;
            for (const target of targets) {
                if (typeof target !== 'string') continue;
                const dot = target.lastIndexOf('.');
                if (dot > 0) queue.push(target.slice(0, dot));
            }
        }
    }
    return false;
}

function upstreamNodes(nodes: GraphNode[], targetId: string): GraphNode[] {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const reverse = new Map<string, string[]>();
    for (const node of nodes) {
        for (const targets of Object.values(node.outputs || {})) {
            if (!Array.isArray(targets)) continue;
            for (const target of targets) {
                if (typeof target !== 'string') continue;
                const dot = target.lastIndexOf('.');
                if (dot <= 0) continue;
                const id = target.slice(0, dot);
                const sources = reverse.get(id) || [];
                sources.push(node.id);
                reverse.set(id, sources);
            }
        }
    }

    const result: GraphNode[] = [];
    const visited = new Set<string>();
    const queue = [...(reverse.get(targetId) || [])];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodeMap.get(id);
        if (!node) continue;
        result.push(node);
        queue.push(...(reverse.get(id) || []));
    }
    return result;
}

function validateImplicitNativeDurationChoice(nodes: GraphNode[], devices: Map<string, DeviceCapabilities>): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const hold of nodes.filter((node) => node.type === 'statusLast')) {
        const timeout = asRecord(hold.props).timeout;
        if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout <= 0) continue;
        const sources = upstreamNodes(nodes, hold.id);
        const dids = [...new Set(sources
            .map((node) => asRecord(node.props).did)
            .filter((did): did is string => typeof did === 'string'))];
        for (const did of dids) {
            const device = devices.get(did);
            if (!device) continue;
            const native = device.properties.find((property) =>
                isDurationProperty(property)
                && property.access.includes('notify')
                && representableDuration(property, timeout));
            if (!native) continue;
            const alreadyNative = sources.some((node) => {
                const props = asRecord(node.props);
                return (node.type === 'deviceInput' || node.type === 'deviceGet')
                    && props.did === did
                    && props.piid === native.piid;
            });
            if (!alreadyNative) {
                errors.push(error(
                    hold,
                    'native_duration_required',
                    `检测到 ${hold.id} 使用 statusLast(${timeout}ms)，但设备 ${did} 的原生时长属性可精确表达该需求；应直接使用 ${nativeDurationDescription(native)}`,
                ));
            }
        }
    }
    return errors;
}

function validateDurationRequirement(nodes: GraphNode[], devices: Map<string, DeviceCapabilities>, requirement?: DurationRequirement | DurationRequirement[]): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const current of durationRequirementsList(requirement)) {
        if (!Number.isInteger(current.durationMs) || current.durationMs <= 0) continue;

        const boundNode = current.nodeId ? nodes.find((node) => node.id === current.nodeId) : undefined;
        if (current.nodeId && !boundNode) {
            errors.push(error({ id: current.nodeId } as GraphNode, 'duration_node_not_found', `时长要求绑定的节点 ${current.nodeId} 不存在`));
            continue;
        }

        const expectedType = current.intent === 'state_hold' ? 'statusLast' : 'delay';
        if (boundNode && boundNode.type !== expectedType) {
            errors.push(error(boundNode, 'duration_node_type_mismatch', `时长要求 ${current.durationMs}ms 应绑定 ${expectedType}，当前是 ${boundNode.type}`));
        }

        const matchingNodes = nodes.filter((node) => node.type === expectedType
            && (!current.nodeId || node.id === current.nodeId)
            && asRecord(node.props).timeout === current.durationMs);
        if (matchingNodes.length === 0) {
            const candidate = boundNode || nodes.find((node) => node.type === expectedType) || nodes[0] || ({id: '(graph)'} as GraphNode);
            errors.push(error(candidate, 'duration_node_mismatch', `${expectedType} 必须有 timeout=${current.durationMs}ms 的节点`));
        }

        if (current.sourceNodeId) {
            const source = nodes.find((node) => node.id === current.sourceNodeId);
            if (!source) {
                errors.push(error(boundNode || ({id: current.sourceNodeId} as GraphNode), 'duration_source_not_found', `时长要求绑定的状态来源节点 ${current.sourceNodeId} 不存在`));
            } else {
                if (current.sourceDid !== undefined && asRecord(source.props).did !== current.sourceDid) {
                    errors.push(error(source, 'duration_source_device_mismatch', `状态来源节点 ${source.id} 不属于设备 ${current.sourceDid}`));
                }
                if (current.sourceOperator !== undefined && asRecord(source.props).operator !== current.sourceOperator) {
                    errors.push(error(source, 'duration_source_operator_mismatch', `状态来源节点 ${source.id} 的 operator 应为 ${current.sourceOperator}`));
                }
                if (current.sourceValues !== undefined) {
                    const sourceValues = asRecord(source.props).v1;
                    const matches = Array.isArray(sourceValues)
                        && sourceValues.length === current.sourceValues.length
                        && sourceValues.every((value, index) => value === current.sourceValues![index]);
                    if (!matches) {
                        errors.push(error(source, 'duration_source_value_mismatch', `状态来源节点 ${source.id} 的 v1 应为 ${JSON.stringify(current.sourceValues)}`));
                    }
                }
                if (boundNode && !graphHasPath(nodes, source.id, boundNode.id)) {
                    errors.push(error(boundNode, 'duration_source_disconnected', `状态来源节点 ${source.id} 未连接到 ${boundNode.id}，请检查有人/无人分支`));
                }
            }
        }

        if (current.intent === 'state_hold') {
            const delays = nodes.filter((node) => node.type === 'delay');
            if (delays.length > 0 && !boundNode) {
                errors.push(error(delays[0], 'delay_used_for_state_hold', '状态持续判定不能使用 delay，应使用 statusLast'));
            }
        } else {
            const statusLast = nodes.filter((node) => node.type === 'statusLast');
            if (statusLast.length > 0 && !boundNode) {
                errors.push(error(statusLast[0], 'delay_intent_mismatch', '动作执行后的等待应使用 delay，不应使用 statusLast'));
            }
        }

        const targetDids = current.targetDids
            || (current.sourceDid ? [current.sourceDid] : [...new Set(nodes.map((node) => asRecord(node.props).did).filter((did): did is string => typeof did === 'string'))]);
        if (current.intent === 'action_delay') continue;
        for (const did of targetDids) {
            const device = devices.get(did);
            if (!device) continue;
            const native = device.properties.filter(isDurationProperty);
            const exactNativeCandidate = native.find((property) => representableDuration(property, current.durationMs));
            const exactNative = exactNativeCandidate?.access.includes('notify') ? exactNativeCandidate : undefined;
            const hasBoundStatusLast = matchingNodes.length > 0;
            const nativeNode = exactNative && nodes.some((node) => {
                const props = asRecord(node.props);
                return (node.type === 'deviceInput' || node.type === 'deviceGet') && props.did === did && props.piid === exactNative.piid;
            });
            if (exactNative && hasBoundStatusLast) {
                errors.push(error(boundNode || nodes[0] || ({id: '(graph)'} as GraphNode), 'native_duration_required', `设备 ${did} 的原生时长属性可精确表示 ${current.durationMs}ms，不能再使用 statusLast；应改用 ${nativeDurationDescription(exactNative)}`));
            } else if (exactNative && !nativeNode) {
                errors.push(error(boundNode || nodes[0] || ({id: '(graph)'} as GraphNode), 'native_duration_preferred', `设备 ${did} 的原生时长属性可精确表示 ${current.durationMs}ms，应使用 ${nativeDurationDescription(exactNative)}`));
            } else if (!exactNativeCandidate && native.length > 0 && current.hardRequirement !== false && !hasBoundStatusLast) {
                const example = native[0];
                errors.push(error(boundNode || nodes[0] || ({id: '(graph)'} as GraphNode), 'duration_not_representable', `设备 ${did} 的原生时长属性无法精确表示 ${current.durationMs}ms（例如 ${nativeDurationDescription(example)}）；应改用 statusLast(timeout=${current.durationMs})`));
            } else if (native.length === 0 && current.hardRequirement !== false && !hasBoundStatusLast) {
                errors.push(error(boundNode || nodes[0] || ({id: '(graph)'} as GraphNode), 'state_hold_missing_status_last', `设备 ${did} 没有可用原生时长属性，必须使用 statusLast(timeout=${current.durationMs})`));
            }
        }
    }
    return errors;
}

interface VariableReference {
    node: GraphNode;
    id: string;
    scope: string;
    expectedType?: 'number' | 'string';
}

const DEVICE_NODE_TYPES = new Set([
    'deviceInput',
    'deviceGet',
    'deviceOutput',
    'deviceInputSetVar',
    'deviceGetSetVar',
]);

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function error(node: GraphNode, type: string, message: string): ValidationError {
    return { nodeId: typeof node?.id === 'string' ? node.id : '(unknown)', type, level: 'error', message };
}

function graphDtypeMatches(miot: string, graph: unknown, setVar: boolean): boolean {
    if (setVar && graph === 'number') return /^(u?int\d*|float)$/.test(miot);
    if (/^u?int\d*$/.test(miot)) return graph === 'int';
    if (miot === 'bool') return graph === 'boolean';
    return graph === miot;
}

function validScalar(value: unknown, dtype: string): boolean {
    if (dtype === 'string') return typeof value === 'string';
    if (dtype === 'bool') return typeof value === 'boolean';
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    return !/^u?int\d*$/.test(dtype) || Number.isInteger(value);
}

function validateValue(node: GraphNode, property: MiotPropertyCapability, operator: unknown, v1: unknown, v2?: unknown): ValidationError[] {
    const errors: ValidationError[] = [];
    if (property.list) {
        if (operator !== 'include' || !Array.isArray(v1)) {
            return [error(node, 'enum_filter', `${property.desc} 是枚举字段，必须使用 operator="include" 和数组 v1；允许值 ${JSON.stringify(property.list.map((item) => item.value))}`)];
        }
        for (const value of v1) {
            if (!validScalar(value, property.dtype) || !property.list.some((item) => item.value === value)) {
                errors.push(error(node, 'enum_value', `${property.desc} 不支持值 ${JSON.stringify(value)}；允许值 ${JSON.stringify(property.list.map((item) => item.value))}`));
            }
        }
        return errors;
    }
    if (property.range) {
        const values = operator === 'between' ? [v1, v2] : [v1];
        if (operator === 'between' && v2 === undefined) errors.push(error(node, 'range_between', `${property.desc} 使用 between 时必须提供 v2`));
        for (const value of values) {
            if (!validScalar(value, property.dtype)) errors.push(error(node, 'value_type', `${property.desc} 需要 ${property.dtype} 类型值`));
            else if (typeof value === 'number' && (value < property.range.min || value > property.range.max || ((value - property.range.min) % property.range.step !== 0))) errors.push(error(node, 'range_value', `${property.desc} 值 ${value} 超出范围 ${JSON.stringify(property.range)}`));
        }
        if (typeof v1 === 'number' && typeof v2 === 'number' && v1 > v2) errors.push(error(node, 'range_order', `${property.desc} 的 v1 不能大于 v2`));
    }
    else if (!validScalar(v1, property.dtype)) errors.push(error(node, 'value_type', `${property.desc} 需要 ${property.dtype} 类型值`));
    return errors;
}

function validateActionInputValue(node: GraphNode, property: MiotPropertyCapability, value: unknown): ValidationError[] {
    if (!validScalar(value, property.dtype)) return [error(node, 'action_input_type', `${property.desc} 需要 ${property.dtype} 类型值`)];
    if (property.list && !property.list.some((item) => item.value === value)) {
        return [error(node, 'action_input_enum', `${property.desc} 不支持值 ${JSON.stringify(value)}；允许值 ${JSON.stringify(property.list.map((item) => item.value))}`)];
    }
    if (property.range && typeof value === 'number' && (value < property.range.min || value > property.range.max || ((value - property.range.min) % property.range.step !== 0))) {
        return [error(node, 'action_input_range', `${property.desc} 值 ${value} 超出范围 ${JSON.stringify(property.range)}`)];
    }
    return [];
}

function validateAction(node: GraphNode, device: DeviceCapabilities): ValidationError[] {
    const siid = node.props.siid;
    const aiid = node.props.aiid;
    if (typeof siid !== 'number' || typeof aiid !== 'number') return [error(node, 'missing_action', '动作节点缺少 siid 或 aiid')];
    const action = device.actions.find((item) => item.siid === siid && item.aiid === aiid);
    if (!action) return [error(node, 'unknown_action', `找不到动作 siid=${siid}, aiid=${aiid}`)];
    const inputs = node.props.ins;
    if (!Array.isArray(inputs)) return action.in.length ? [error(node, 'missing_action_input', `${action.desc} 需要输入参数`)] : [];

    const errors: ValidationError[] = [];
    for (const input of inputs) {
        if (!input || typeof input !== 'object') { errors.push(error(node, 'invalid_action_input', `${action.desc} 的输入参数格式错误`)); continue; }
        const entry = input as Record<string, unknown>;
        const property = typeof entry.piid === 'number' ? action.in.find((item) => item.piid === entry.piid) : undefined;
        if (!property) { errors.push(error(node, 'unknown_action_input', `${action.desc} 不支持输入 piid=${String(entry.piid)}`)); continue; }
        if (typeof entry.id === 'string' && typeof entry.scope === 'string') {
            if (!graphDtypeMatches(property.dtype, entry.dtype, true)) errors.push(error(node, 'action_input_type', `${property.desc} 的 MIOT 类型为 ${property.dtype}，变量类型不兼容`));
            continue;
        }
        errors.push(...validateActionInputValue(node, property, entry.value));
    }
    for (const property of action.in) {
        if (!inputs.some((input) => input && typeof input === 'object' && (input as Record<string, unknown>).piid === property.piid)) {
            errors.push(error(node, 'missing_action_input', `${action.desc} 缺少输入 ${property.desc}`));
        }
    }
    return errors;
}

function variableReferences(nodes: GraphNode[]): VariableReference[] {
    const references: VariableReference[] = [];
    const add = (node: GraphNode, value: unknown, expectedType?: 'number' | 'string'): void => {
        if (!value || typeof value !== 'object') return;
        const ref = value as Record<string, unknown>;
        if (typeof ref.id === 'string' && typeof ref.scope === 'string') references.push({ node, id: ref.id, scope: ref.scope, expectedType });
    };

    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const props = asRecord(node.props);
        const declaredType = props.varType === 'string' || props.dtype === 'string' ? 'string' : 'number';
        const resultType = node.type === 'varSetString' ? 'string' : ['varSetNumber', 'deviceInputSetVar', 'deviceGetSetVar', 'varChange', 'varGet'].includes(node.type) ? declaredType : undefined;
        if (resultType) add(node, props, resultType);
        if (node.type === 'deviceOutput' && typeof props.aiid !== 'number') {
            const dtype = props.dtype;
            add(node, props, dtype === 'string' ? 'string' : dtype === 'number' ? 'number' : undefined);
        }
        if (node.type === 'deviceOutput' && Array.isArray(props.ins)) for (const input of props.ins) {
            const dtype = input && typeof input === 'object' ? (input as Record<string, unknown>).dtype : undefined;
            add(node, input, dtype === 'string' ? 'string' : dtype === 'number' ? 'number' : undefined);
        }
        if (node.type === 'deviceInputSetVar' && Array.isArray(props.arguments)) for (const argument of props.arguments) {
            const dtype = argument && typeof argument === 'object' ? (argument as Record<string, unknown>).dtype : undefined;
            add(node, argument, dtype === 'string' ? 'string' : 'number');
        }
        if (Array.isArray(props.elements)) for (const element of props.elements) {
            if (element && typeof element === 'object' && (element as Record<string, unknown>).type === 'var') add(node, element, node.type === 'varSetNumber' ? 'number' : undefined);
        }
    }
    return references;
}

export function graphReferencesVariable(nodes: GraphNode[], id: string, scope: string): boolean {
    return variableReferences(nodes).some((reference) => reference.id === id && reference.scope === scope);
}

export async function validateGraphVariablesWithGateway(gateway: GatewayClient, nodes: GraphNode[]): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    const variablesByScope = new Map<string, Map<string, Variable>>();
    for (const reference of variableReferences(nodes)) {
        if (!variablesByScope.has(reference.scope)) {
            try {
                const response = await gateway.callApi<Variable[] | Record<string, Variable>>('getVarList', { scope: reference.scope }, 10000);
                const entries = Array.isArray(response)
                    ? response.flatMap((variable) => typeof variable.id === 'string' ? [[variable.id, variable] as const] : [])
                    : Object.entries(response || {});
                variablesByScope.set(reference.scope, new Map(entries));
            } catch (cause) {
                errors.push(error(reference.node, 'variable_scope_unavailable', `无法读取变量作用域 ${reference.scope}: ${String(cause)}`));
                variablesByScope.set(reference.scope, new Map());
            }
        }
        const variable = variablesByScope.get(reference.scope)!.get(reference.id);
        if (!variable) errors.push(error(reference.node, 'unknown_variable', `变量 ${reference.scope}/${reference.id} 不存在`));
        else if (reference.expectedType && variable.type !== reference.expectedType) errors.push(error(reference.node, 'variable_type_mismatch', `变量 ${reference.scope}/${reference.id} 类型为 ${String(variable.type)}，需要 ${reference.expectedType}`));
    }
    return errors;
}

export function validateGraphCapabilities(nodes: GraphNode[], devices: Map<string, DeviceCapabilities>, requirement?: DurationRequirement | DurationRequirement[]): CapabilityValidationReport {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    for (const node of nodes) {
        if (!node || typeof node !== 'object') {
            errors.push({ nodeId: '(unknown)', type: 'invalid_node', level: 'error', message: '节点格式错误' });
            continue;
        }
        if (!DEVICE_NODE_TYPES.has(node.type)) continue;
        const props = asRecord(node.props);
        if (Object.keys(props).length === 0) {
            errors.push(error(node, 'missing_props', '设备节点缺少 props'));
            continue;
        }
        const did = props.did;
        if (typeof did !== 'string' || !devices.has(did)) { errors.push(error(node, 'unknown_device', `找不到设备 ${String(did)}`)); continue; }
        const device = devices.get(did)!;
        const nodeUrn = asRecord(node.cfg).urn;
        if (typeof nodeUrn === 'string' && nodeUrn.length > 0 && nodeUrn !== device.urn) { errors.push(error(node, 'urn_mismatch', `节点 URN 与设备 ${did} 的 URN 不一致`)); continue; }
        const siid = props.siid;
        if (typeof siid !== 'number') { errors.push(error(node, 'missing_siid', '缺少 siid')); continue; }
        if ((node.type === 'deviceInput' || node.type === 'deviceInputSetVar') && typeof props.eiid === 'number') {
            const event = device.events.find((item) => item.siid === siid && item.eiid === props.eiid);
            if (!event) { errors.push(error(node, 'unknown_event', `找不到事件 siid=${siid}, eiid=${String(props.eiid)}`)); continue; }
            if (node.type === 'deviceInputSetVar') {
                if (!Array.isArray(props.arguments)) { errors.push(error(node, 'missing_event_arguments', `${event.desc} 缺少事件参数赋值`)); continue; }
                const seenPiids = new Set<number>();
                for (const argument of props.arguments) {
                    if (!argument || typeof argument !== 'object') { errors.push(error(node, 'invalid_event_argument', `${event.desc} 的事件参数格式错误`)); continue; }
                    const entry = argument as Record<string, unknown>;
                    const property = typeof entry.piid === 'number' ? event.arguments.find((item) => item.piid === entry.piid) : undefined;
                    if (!property) { errors.push(error(node, 'unknown_event_argument', `${event.desc} 不支持参数 piid=${String(entry.piid)}`)); continue; }
                    if (seenPiids.has(property.piid)) { errors.push(error(node, 'duplicate_event_argument', `${event.desc} 的参数 piid=${property.piid} 重复赋值`)); continue; }
                    seenPiids.add(property.piid);
                    if (typeof entry.id !== 'string' || typeof entry.scope !== 'string') errors.push(error(node, 'missing_event_argument_variable', `${property.desc} 缺少变量 id 或 scope`));
                    if (!graphDtypeMatches(property.dtype, entry.dtype, true)) errors.push(error(node, 'event_argument_type', `${property.desc} 的 MIOT 类型为 ${property.dtype}，变量类型不兼容`));
                }
            }
            continue;
        }
        if (node.type === 'deviceOutput' && typeof props.aiid === 'number') {
            errors.push(...validateAction(node, device));
            continue;
        }
        const piid = props.piid;
        const property = typeof piid === 'number' ? device.properties.find((item) => item.siid === siid && item.piid === piid) : undefined;
        if (!property) { errors.push(error(node, 'unknown_property', `找不到属性 siid=${siid}, piid=${String(piid)}`)); continue; }
        const requiredAccess = node.type === 'deviceInput' || node.type === 'deviceInputSetVar' ? 'notify' : node.type === 'deviceGet' || node.type === 'deviceGetSetVar' ? 'read' : 'write';
        if (!property.access.includes(requiredAccess)) errors.push(error(node, 'access_denied', `${property.desc} 不支持 ${requiredAccess}`));
        const setVar = node.type === 'deviceInputSetVar' || node.type === 'deviceGetSetVar';
        const hasDynamicReference = node.type === 'deviceOutput' && (props.id !== undefined || props.scope !== undefined || props.dtype !== undefined);
        const dynamicOutput = hasDynamicReference && typeof props.id === 'string' && typeof props.scope === 'string' && props.dtype !== undefined;
        const variableValue = setVar || dynamicOutput;
        if (props.dtype !== undefined && !graphDtypeMatches(property.dtype, props.dtype, variableValue)) errors.push(error(node, 'dtype_mismatch', `${property.desc} 的 MIOT 类型为 ${property.dtype}，节点类型应兼容 ${variableValue ? 'number' : property.dtype}`));
        if (node.type === 'deviceOutput') {
            if (hasDynamicReference && !dynamicOutput) {
                errors.push(error(node, 'incomplete_variable_reference', `${property.desc} 的动态变量引用必须同时提供 id、scope 和 dtype`));
                continue;
            }
            if (dynamicOutput) {
                if (property.range && (props.min !== property.range.min || props.max !== property.range.max || props.step !== property.range.step)) {
                    errors.push(error(node, 'range_mismatch', `${property.desc} 的动态变量范围应为 ${JSON.stringify(property.range)}`));
                }
            } else {
                errors.push(...validateActionInputValue(node, property, props.value));
            }
        }
        else if (!setVar) errors.push(...validateValue(node, property, props.operator, props.v1, props.v2));
    }
    errors.push(...validateDurationRequirement(nodes, devices, requirement));
    if (durationRequirementsList(requirement).length === 0) {
        errors.push(...validateImplicitNativeDurationChoice(nodes, devices));
    }
    return { valid: errors.length === 0, errors, warnings, inspectedDids: [...devices.keys()], inspectedUrns: [...new Set([...devices.values()].map((device) => device.urn))] };
}

export async function validateGraphCapabilitiesWithGateway(gateway: GatewayClient, graph: Graph, requirement?: DurationRequirement | DurationRequirement[]): Promise<CapabilityValidationReport> {
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const dids = [...new Set(nodes
        .map((node) => node && typeof node === 'object' ? asRecord(node.props).did : undefined)
        .filter((did): did is string => typeof did === 'string'))];
    const specs = new Map<string, DeviceCapabilities>();
    const errors: ValidationError[] = [];
    let devList: DeviceListResponse['devList'] = {};
    if (dids.length > 0) {
        try {
            const response = await gateway.callApi<DeviceListResponse>('getDevList', {}, 10000);
            devList = response?.devList && typeof response.devList === 'object' ? response.devList : {};
        } catch (cause) {
            const variableErrors = await validateGraphVariablesWithGateway(gateway, nodes);
            return {
                valid: false,
                errors: [{ nodeId: '(graph)', type: 'device_list_unavailable', level: 'error', message: `无法读取设备列表: ${String(cause)}` }, ...variableErrors],
                warnings: [],
                inspectedDids: [],
                inspectedUrns: [],
            };
        }
    }

    for (const node of nodes) {
        if (!node || typeof node !== 'object' || !DEVICE_NODE_TYPES.has(node.type)) continue;
        const did = asRecord(node.props).did;
        const device = typeof did === 'string' ? devList[did] : undefined;
        if (!device?.urn) continue;
        const cfg = asRecord(node.cfg);
        if (typeof cfg.urn !== 'string' || cfg.urn.length === 0) {
            node.cfg = { ...cfg, urn: device.urn };
        }
    }

    for (const did of dids) {
        const device = devList[did];
        if (!device?.urn) { errors.push({ nodeId: '(graph)', type: 'unknown_device', level: 'error', message: `设备 ${did} 缺少本地 URN` }); continue; }
        if (!specs.has(device.urn)) {
            try {
                const result = await fetch(`https://miot-spec.org/miot-spec-v2/instance?type=${encodeURIComponent(device.urn)}`, {
                    signal: AbortSignal.timeout(10000),
                });
                if (!result.ok) throw new Error(`HTTP ${result.status}`);
                const normalized = normalizeMiotSpec(await result.json() as { services?: Array<never> });
                specs.set(device.urn, { urn: device.urn, properties: normalized.properties || [], events: normalized.events || [], actions: (normalized.actions || []).flatMap((action) => action.type === 'action' && typeof action.aiid === 'number' ? [{ siid: action.siid, aiid: action.aiid, desc: action.desc, in: action.in || [] }] : []) });
            } catch (cause) {
                errors.push({ nodeId: '(graph)', type: 'spec_unavailable', level: 'error', message: `无法读取 ${device.urn} 的 MIOT Spec: ${String(cause)}` });
            }
        }
    }
    const devices = new Map<string, DeviceCapabilities>();
    for (const did of dids) {
        const device = devList[did];
        if (device?.urn && specs.has(device.urn)) devices.set(did, specs.get(device.urn)!);
    }
    const report = validateGraphCapabilities(nodes, devices, requirement);
    report.errors.push(...await validateGraphVariablesWithGateway(gateway, nodes));
    report.errors.unshift(...errors);
    report.valid = report.errors.length === 0;
    return report;
}
