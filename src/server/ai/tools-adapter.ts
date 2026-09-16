/**
 * Web Agent - 工具适配器
 * 将 Core 工具函数适配为 Vercel AI SDK 格式
 */

import {z} from 'zod';
import {tool} from 'ai';
import {jsonSchema, type Schema, zodSchema} from '@ai-sdk/ui-utils';
import {
    callGatewayApi,
    createGraph,
    createVariable,
    deleteGraph,
    deleteVariable,
    findDeviceUsage,
    findDeviceUsageInputSchema,
    getDevice,
    getDevices,
    getGraph,
    getGraphs,
    getVariableConfig,
    getVariables,
    getVariableValue,
    layoutNodes,
    setVariable,
    toggleGraph,
    updateGraph,
    validateGraph,
    validateGraphCapabilitiesWithGateway,
    type GatewayClient,
} from '@/core';
import {getSkillByName, formatSkillContent, readSkillFile, getSkillCatalog} from '../skills/loader';

function patchArrayItems(schema: unknown): unknown {
    if (Array.isArray(schema)) {
        return schema.map(patchArrayItems);
    }

    if (schema === null || typeof schema !== 'object') {
        return schema;
    }

    const patched = Object.fromEntries(
        Object.entries(schema).map(([key, value]) => [key, patchArrayItems(value)])
    ) as Record<string, unknown>;

    if (patched.type === 'array' && !('items' in patched)) {
        patched.items = {};
    }

    return patched;
}

function compatibleParameters<OBJECT>(
    schema: z.Schema<OBJECT, z.ZodTypeDef, any>
): Schema<OBJECT> {
    const baseSchema = zodSchema(schema);

    return jsonSchema<OBJECT>(patchArrayItems(baseSchema.jsonSchema) as any, {
        validate: (value: unknown) => {
            const result = schema.safeParse(value);
            return result.success
                ? {success: true, value: result.data}
                : {success: false, error: result.error};
        },
    });
}

function defineTool<P extends z.Schema<any, z.ZodTypeDef, any>, RESULT>(config: {
    description?: string;
    parameters: P;
    execute?: (args: z.infer<P>, options: {abortSignal?: AbortSignal}) => PromiseLike<RESULT>;
}) {
    return tool({
        ...config,
        parameters: compatibleParameters(config.parameters),
    } as any);
}

export function createCoreTools(gateway: GatewayClient) {
    return {
        think: defineTool({
            description: '仅用于复杂任务的思考（如创建规则）。简单任务（查询设备、查看规则等）不要使用此工具，直接调用相应工具即可。',
            parameters: z.object({
                thought: z.string().describe('思考内容'),
                nextAction: z.string().optional().describe('下一步行动'),
            }),
            execute: async ({thought, nextAction}) => {
                return {
                    success: true,
                    thought,
                    nextAction,
                };
            },
        }),

        ask_user: defineTool({
            description: '向用户呈现交互式选择方案或确认对话框。当为用户设计了 2-3 个方案（如方案1、方案2）、或需要用户做选择/确认时，必须调用此工具将选项展示为前端可点击按钮，严禁仅在普通回复文本中输出选项列表。',
            parameters: z.object({
                question: z.string().describe('问题或方案详细说明'),
                options: z.array(z.string()).describe('可点击的选项列表，如 ["方案1: ...", "方案2: ..."]'),
                needConfirm: z.boolean().optional().describe('是否需要确认'),
            }),
            execute: async ({question, options, needConfirm}) => {
                return {
                    success: true,
                    needsUserInput: true,
                    question,
                    options,
                    needConfirm,
                };
            },
        }),

        get_devices: defineTool({
            description: '获取设备列表（预览模式，只返回关键字段）',
            parameters: z.object({}),
            execute: async () => {
                return getDevices(gateway);
            },
        }),

        get_device: defineTool({
            description: '获取设备详情、完整 URN 及 MIOT Spec 能力。规则节点 cfg.urn 应使用返回的 urn，不要从型号推导或猜测版本号。',
            parameters: z.object({
                dids: z.array(z.string()).describe('设备ID数组'),
            }),
            execute: async ({dids}) => {
                return getDevice(gateway, dids);
            },
        }),

        find_device_usage: defineTool({
            description: '只读扫描自动化规则，查询设备被哪些规则和节点引用，区分触发、读取、控制，并报告设备列表中不存在的残留引用。dids 与 query 至少提供一项，同时提供时取并集。单次扫描总时限 30 秒；complete=false 时必须提示扫描不完整，不能断言没有引用。enable=null 表示启用状态未知。结果不证明规则实际执行过，也不授权修改规则。',
            parameters: findDeviceUsageInputSchema,
            execute: async (input, {abortSignal}) => findDeviceUsage(gateway, input, {signal: abortSignal}),
        }),

        call_gateway_api: defineTool({
            description: '仅在用户明确要求排障、发现网关接口或查询未被专用工具覆盖的只读数据时使用。优先使用设备、规则、变量等专用工具；getApiList 是兼容别名，返回本应用已验证的接口清单，不会请求网关。写入、删除和未知方法会被拒绝。',
            parameters: z.object({
                method: z.string().describe('已验证的只读网关 API 方法名，例如 getLog、getVarScopeList；getApiList 返回本地兼容接口清单'),
                params: z.record(z.unknown()).default({}).describe('API 参数对象'),
                timeout: z.number().int().min(1000).max(10000).default(10000).describe('超时时间（毫秒）'),
            }),
            execute: async ({method, params, timeout}) => {
                return callGatewayApi(gateway, method, params, timeout);
            },
        }),

        get_graphs: defineTool({
            description: '获取所有自动化规则列表',
            parameters: z.object({}),
            execute: async () => {
                return getGraphs(gateway);
            },
        }),

        get_graph: defineTool({
            description: '获取指定规则的详细信息',
            parameters: z.object({
                id: z.string().describe('规则ID'),
            }),
            execute: async ({id}) => {
                return getGraph(gateway, id);
            },
        }),

        create_graph: defineTool({
            description: '创建新的自动化规则',
            parameters: z.object({
                name: z.string().describe('规则名称'),
                nodes: z.array(z.any()).describe('节点列表'),
                variables: z.array(z.discriminatedUnion('type', [
                    z.object({id: z.string().regex(/^[a-zA-Z0-9]+$/), type: z.literal('number'), value: z.number(), name: z.string().trim().min(1).optional()}),
                    z.object({id: z.string().regex(/^[a-zA-Z0-9]+$/), type: z.literal('string'), value: z.string(), name: z.string().trim().min(1).optional()}),
                ])).optional().describe('本规则变量定义；节点引用时 scope 使用 rule'),
                durationRequirement: z.object({
                    durationMs: z.number().int().positive(),
                    intent: z.enum(['state_hold', 'action_delay']),
                    hardRequirement: z.boolean().optional(),
                    targetDids: z.array(z.string()).optional(),
                    nodeId: z.string().optional(),
                    sourceNodeId: z.string().optional(),
                    sourceDid: z.string().optional(),
                    sourceOperator: z.string().optional(),
                    sourceValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
                }).optional().describe('时间意图：状态持续或动作后延时；durationMs 始终为毫秒，可绑定具体 nodeId/sourceNodeId'),
                durationRequirements: z.array(z.object({
                    durationMs: z.number().int().positive(),
                    intent: z.enum(['state_hold', 'action_delay']),
                    hardRequirement: z.boolean().optional(),
                    targetDids: z.array(z.string()).optional(),
                    nodeId: z.string().optional(),
                    sourceNodeId: z.string().optional(),
                    sourceDid: z.string().optional(),
                    sourceOperator: z.string().optional(),
                    sourceValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
                })).optional().describe('多个独立时长意图；每项应绑定具体 nodeId，避免不同分支共用一条全局时长'),
                enable: z.boolean().optional().describe('是否启用'),
            }),
            execute: async ({name, nodes, variables, durationRequirement, durationRequirements, enable = true}) => {
                return createGraph(gateway, {name, nodes, variables, durationRequirement, durationRequirements, enable});
            },
        }),

        update_graph: defineTool({
            description: '更新现有规则',
            parameters: z.object({
                id: z.string().describe('规则ID'),
                name: z.string().optional().describe('新规则名称'),
                nodes: z.array(z.any()).optional().describe('新节点列表'),
                enable: z.boolean().optional().describe('是否启用'),
                durationRequirement: z.object({
                    durationMs: z.number().int().positive(),
                    intent: z.enum(['state_hold', 'action_delay']),
                    hardRequirement: z.boolean().optional(),
                    targetDids: z.array(z.string()).optional(),
                    nodeId: z.string().optional(),
                    sourceNodeId: z.string().optional(),
                    sourceDid: z.string().optional(),
                    sourceOperator: z.string().optional(),
                    sourceValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
                }).optional().describe('时间意图；durationMs 始终为毫秒，可绑定具体 nodeId/sourceNodeId'),
                durationRequirements: z.array(z.object({
                    durationMs: z.number().int().positive(),
                    intent: z.enum(['state_hold', 'action_delay']),
                    hardRequirement: z.boolean().optional(),
                    targetDids: z.array(z.string()).optional(),
                    nodeId: z.string().optional(),
                    sourceNodeId: z.string().optional(),
                    sourceDid: z.string().optional(),
                    sourceOperator: z.string().optional(),
                    sourceValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
                })).optional().describe('多个独立时长意图；每项应绑定具体 nodeId'),
            }),
            execute: async ({id, name, nodes, enable, durationRequirement, durationRequirements}) => {
                return updateGraph(gateway, id, {name, nodes, enable, durationRequirement, durationRequirements});
            },
        }),

        delete_graph: defineTool({
            description: '删除指定的自动化规则',
            parameters: z.object({
                id: z.string().describe('规则ID'),
            }),
            execute: async ({id}) => {
                return deleteGraph(gateway, id);
            },
        }),

        toggle_graph: defineTool({
            description: '启用或禁用指定的自动化规则',
            parameters: z.object({
                id: z.string().describe('规则ID'),
                enable: z.boolean().describe('是否启用'),
            }),
            execute: async ({id, enable}) => {
                return toggleGraph(gateway, id, enable);
            },
        }),

        get_variables: defineTool({
            description: '获取变量列表',
            parameters: z.object({
                scope: z.string().optional().describe('变量作用域'),
            }),
            execute: async ({scope = 'global'}) => {
                return getVariables(gateway, scope);
            },
        }),

        set_variable: defineTool({
            description: '设置变量的值',
            parameters: z.object({
                id: z.string().describe('变量ID'),
                value: z.union([z.string(), z.number()]).describe('变量值'),
                scope: z.string().optional().describe('变量作用域'),
            }),
            execute: async ({id, value, scope = 'global'}) => {
                return setVariable(gateway, id, value, scope);
            },
        }),

        create_variable: defineTool({
            description: '创建自动化变量',
            parameters: z.object({id: z.string().regex(/^[a-zA-Z0-9]+$/), type: z.enum(['number', 'string']), value: z.union([z.number(), z.string()]), name: z.string().trim().min(1).optional(), scope: z.string().optional()}),
            execute: async ({id, type, value, name, scope = 'global'}) => {
                if (typeof value !== type) return {success: false, error: 'value 必须与 type 匹配'};
                return createVariable(gateway, id, type, value, name, scope);
            },
        }),

        delete_variable: defineTool({
            description: '删除自动化变量；仍被规则引用时拒绝删除',
            parameters: z.object({
                id: z.string().describe('变量 ID'),
                scope: z.string().optional().describe('变量作用域'),
            }),
            execute: async ({id, scope = 'global'}) => {
                return deleteVariable(gateway, id, scope);
            },
        }),

        get_variable_value: defineTool({
            description: '获取变量当前值',
            parameters: z.object({id: z.string(), scope: z.string().optional()}),
            execute: async ({id, scope = 'global'}) => getVariableValue(gateway, id, scope),
        }),

        get_variable_config: defineTool({
            description: '获取变量配置',
            parameters: z.object({id: z.string(), scope: z.string().optional()}),
            execute: async ({id, scope = 'global'}) => getVariableConfig(gateway, id, scope),
        }),

        validate_graph: defineTool({
            description: '校验规则连接完整性。传入完整候选图的 nodes；cfg 可省略（仅作结构预检时会使用安全草稿 cfg），但创建或更新前仍必须对完整候选图做校验。',
            parameters: z.object({
                nodes: z.array(z.any()).describe('节点列表'),
                cfg: z.object({
                    id: z.string(),
                    enable: z.boolean(),
                    uiType: z.string(),
                    userData: z.object({
                        name: z.string(),
                        lastUpdateTime: z.number(),
                        transform: z.object({x: z.number(), y: z.number(), scale: z.number(), rotate: z.number()}),
                    }),
                }).optional().describe('完整候选图的 cfg；仅结构预检时可省略'),
            }),
            execute: async ({nodes, cfg}) => {
                const resolvedCfg = cfg || {
                    id: 'validation-draft',
                    enable: false,
                    uiType: 'graph',
                    userData: {
                        name: '结构校验草稿',
                        lastUpdateTime: Date.now(),
                        transform: {x: 0, y: 0, scale: 1, rotate: 0},
                    },
                };
                const graph = {id: resolvedCfg.id, nodes, cfg: resolvedCfg};
                const errors = validateGraph(graph as any);

                if (errors.length === 0) {
                    return {success: true, valid: true, message: '规则校验通过'};
                }

                const errorList = errors
                    .filter(e => e.level === 'error')
                    .map(e => ({node: e.nodeId, type: e.type, message: e.message}));
                const warnList = errors
                    .filter(e => e.level === 'warn')
                    .map(e => ({node: e.nodeId, type: e.type, message: e.message}));

                return {
                    success: true,
                    valid: errorList.length === 0,
                    errors: errorList,
                    warnings: warnList,
                    message: errorList.length > 0
                        ? `发现 ${errorList.length} 个错误，必须修复后才能创建规则`
                        : `校验通过（${warnList.length} 个警告）`,
                };
            },
        }),

        validate_graph_capabilities: defineTool({
            description: '根据真实 MIOT Spec 校验完整候选图中的设备能力和变量引用。空图通过仅表示没有设备引用可检查，不能据此跳过候选图校验。',
            parameters: z.object({
                graph: z.object({
                    id: z.string().optional(),
                    nodes: z.array(z.any()),
                    cfg: z.any().optional(),
                    durationRequirement: z.object({
                        durationMs: z.number().int().positive(),
                        intent: z.enum(['state_hold', 'action_delay']),
                        hardRequirement: z.boolean().optional(),
                        targetDids: z.array(z.string()).optional(),
                        nodeId: z.string().optional(),
                        sourceNodeId: z.string().optional(),
                        sourceDid: z.string().optional(),
                        sourceOperator: z.string().optional(),
                        sourceValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
                    }).optional(),
                    durationRequirements: z.array(z.object({
                        durationMs: z.number().int().positive(),
                        intent: z.enum(['state_hold', 'action_delay']),
                        hardRequirement: z.boolean().optional(),
                        targetDids: z.array(z.string()).optional(),
                        nodeId: z.string().optional(),
                        sourceNodeId: z.string().optional(),
                        sourceDid: z.string().optional(),
                        sourceOperator: z.string().optional(),
                        sourceValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
                    })).optional(),
                }),
            }),
            execute: async ({graph}) => validateGraphCapabilitiesWithGateway(gateway, {
                id: graph.id || 'validation-draft',
                nodes: graph.nodes,
                cfg: graph.cfg || {},
            } as any, graph.durationRequirements ?? graph.durationRequirement),
        }),

        activate_skill: defineTool({
            description: '激活指定的 Skill',
            parameters: z.object({
                name: z.string().describe('Skill 名称'),
            }),
            execute: async ({name}) => {
                const skill = getSkillByName(name);
                if (!skill) {
                    const catalog = getSkillCatalog();
                    const available = catalog.map(s => s.name).join(', ');
                    return {
                        success: false,
                        error: `Skill "${name}" 不存在。可用的 Skills: ${available}`,
                    };
                }

                return {
                    success: true,
                    skill: skill.name,
                    content: formatSkillContent(skill),
                    resources: skill.resources,
                    message: `已激活 Skill: ${skill.name}`,
                };
            },
        }),

        read_skill_file: defineTool({
            description: '读取 Skill 目录中的资源文件',
            parameters: z.object({
                skillName: z.string().describe('Skill 名称'),
                filePath: z.string().describe('相对于 Skill 目录的文件路径'),
            }),
            execute: async ({skillName, filePath}) => {
                const content = readSkillFile(skillName, filePath);
                if (content === null) {
                    return {
                        success: false,
                        error: `无法读取文件: ${filePath}`,
                    };
                }

                return {
                    success: true,
                    skillName,
                    filePath,
                    content,
                };
            },
        }),
    };
}
