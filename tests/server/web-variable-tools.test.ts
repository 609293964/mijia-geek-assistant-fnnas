import assert from 'node:assert/strict';
import test from 'node:test';
import type {GatewayClient} from '../../src/core/gateway/client';
import {createCoreTools} from '../../src/server/ai/tools-adapter';

test('Web Agent 公开完整变量生命周期工具', () => {
    const tools = createCoreTools({} as GatewayClient) as any;
    for (const name of ['create_variable', 'delete_variable', 'get_variable_value', 'get_variable_config']) {
        assert.equal(typeof tools[name]?.execute, 'function');
    }
});

test('Web Agent 公开独立 MIOT 能力预检工具', async () => {
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            if (method === 'getVarList') return {};
            throw new Error(`非预期调用：${method}`);
        },
    } as unknown as GatewayClient;
    const tools = createCoreTools(gateway) as any;

    const result = await tools.validate_graph_capabilities.execute({
        graph: {id: '1', nodes: [], cfg: {}},
    });

    assert.equal(result.valid, true);
});

test('能力预检允许省略仅结构无关的图 cfg', async () => {
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            if (method === 'getVarList') return {};
            throw new Error(`非预期调用：${method}`);
        },
    } as unknown as GatewayClient;
    const tools = createCoreTools(gateway) as any;

    const result = await tools.validate_graph_capabilities.execute({graph: {nodes: []}});

    assert.equal(result.valid, true);
});

test('能力预检为缺少 cfg 的设备节点补齐真实 URN', async () => {
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            if (method === 'getDevList') return {
                devList: {
                    lamp: {name: '测试灯', model: 'test.lamp', modelName: '测试灯', online: true, roomName: '书房', urn: 'urn:test:lamp'},
                },
            };
            throw new Error(`非预期调用：${method}`);
        },
    } as unknown as GatewayClient;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        services: [{
            iid: 2,
            description: 'Light',
            properties: [{iid: 1, description: 'Power', format: 'bool', access: ['write']}],
        }],
    }), {status: 200, headers: {'content-type': 'application/json'}});

    try {
        const tools = createCoreTools(gateway) as any;
        const graph: any = {
            id: '1',
            nodes: [{id: 'power', type: 'deviceOutput', props: {did: 'lamp', siid: 2, piid: 1, value: true}, inputs: {trigger: null}, outputs: {output: []}}],
            cfg: {},
        };
        const result = await tools.validate_graph_capabilities.execute({graph});

        assert.equal(result.valid, true);
        assert.equal(graph.nodes[0].cfg.urn, 'urn:test:lamp');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('设备列表读取失败时能力预检返回结构化错误', async () => {
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            if (method === 'getDevList') throw new Error('gateway offline');
            throw new Error(`非预期调用：${method}`);
        },
    } as unknown as GatewayClient;
    const tools = createCoreTools(gateway) as any;
    const result = await tools.validate_graph_capabilities.execute({
        graph: {
            id: '1',
            nodes: [{id: 'power', type: 'deviceOutput', props: {did: 'lamp', siid: 2, piid: 1, value: true}, inputs: {trigger: null}, outputs: {output: []}}],
            cfg: {},
        },
    });

    assert.equal(result.valid, false);
    assert.equal(result.errors[0].type, 'device_list_unavailable');
});

test('网页端 create_graph 透传本规则变量定义', async () => {
    const calls: Array<{method: string; params: any}> = [];
    const variables: Record<string, any> = {};
    const gateway = {
        async callApi(method: string, params: any): Promise<unknown> {
            calls.push({method, params});
            if (method === 'getGraphList') return [];
            if (method === 'getVarScopeList') return {scopes: []};
            if (method === 'createVar') variables[params.id] = {type: params.type, value: params.value, userData: params.userData};
            if (method === 'getVarList') return variables;
            return undefined;
        },
    } as unknown as GatewayClient;
    const tools = createCoreTools(gateway) as any;

    const result = await tools.create_graph.execute({
        name: '网页端变量规则',
        nodes: [
            {id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: {output: ['calc.input']}},
            {id: 'calc', type: 'varSetNumber', cfg: {}, props: {id: 'result', scope: 'rule', elements: [{type: 'const', value: '1'}]}, inputs: {input: null}, outputs: {output: []}},
        ],
        variables: [{id: 'result', type: 'number', value: 0, name: '结果'}],
        enable: false,
    });

    assert.equal(result.success, true);
    assert.equal(calls.some(call => call.method === 'createVar'), true);
    const saved = calls.filter(call => call.method === 'setGraph').at(-1)?.params;
    assert.match(saved.nodes.find((node: any) => node.id === 'calc').props.scope, /^R\d{13}$/);
});
