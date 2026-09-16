import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayClient } from '../../src/core/gateway/client';
import { createGraph, deleteGraph, getGraph, updateGraph } from '../../src/core/tools/graph';

test('规则详情缺少 cfg 时使用列表元数据补齐', async () => {
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            if (method === 'getGraph') return { id: '123', nodes: [] };
            if (method === 'getGraphList') return [{
                id: '123',
                enable: true,
                userData: {
                    name: '补齐规则',
                    lastUpdateTime: 42,
                    transform: { x: 1, y: 2, scale: 1, rotate: 0 },
                },
            }];
            throw new Error(`意外的方法 ${method}`);
        },
    } as unknown as GatewayClient;

    const result = await getGraph(gateway, '123');

    assert.equal(result.success, true);
    assert.equal(result.success ? result.data?.cfg.enable : false, true);
    assert.equal(result.success ? result.data?.cfg.userData.name : '', '补齐规则');
});

test('创建规则时拒绝未登记变量且不调用 setGraph', async () => {
    const calls: string[] = [];
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            calls.push(method);
            if (method === 'getGraphList') return [];
            if (method === 'getVarScopeList') return { scopes: [] };
            if (method === 'getVarList') return {};
            throw new Error(`意外的方法 ${method}`);
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'Variable Guard',
        enable: false,
        nodes: [{
            id: 'set1',
            type: 'varSetNumber',
            cfg: { name: 'varSetNumber', version: 1 },
            props: { id: 'missing', scope: 'global', elements: [{ type: 'const', value: '1' }] },
            inputs: { input: null },
            outputs: { output: [] },
        }],
    });

    assert.equal(result.success, false);
    assert.match('error' in result ? result.error : '', /变量 global\/missing 不存在/);
    assert.deepEqual(calls, ['getGraphList', 'getVarScopeList', 'getVarList']);
});

test('创建规则使用极客版本规则变量兼容的纯数字 ID', async () => {
    let graph: unknown;
    const gateway = {
        async callApi(method: string, input: unknown): Promise<unknown> {
            if (method === 'setGraph') graph = input;
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'Numeric Graph ID',
        enable: false,
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, true);
    assert.match(result.success ? result.data!.graphId : '', /^\d+$/);
    assert.match((graph as { id: string }).id, /^\d+$/);
});

test('创建规则自动补齐 statusLast 的 UI 维持时间字段', async () => {
    let graph: any;
    const gateway = {
        async callApi(method: string, input: unknown): Promise<unknown> {
            if (method === 'setGraph') graph = input;
            if (method === 'getGraphList') return [];
            if (method === 'getVarScopeList') return { scopes: [] };
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'StatusLast UI',
        enable: false,
        nodes: [
            { id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: ['hold.input'] } },
            { id: 'hold', type: 'statusLast', cfg: {}, props: { timeout: 30000 }, inputs: { input: null }, outputs: { output: [] } },
        ],
    });

    assert.equal(result.success, true);
    const savedHold = graph.nodes.find((node: any) => node.id === 'hold');
    assert.deepEqual(savedHold.cfg, {
        name: 'statusLast',
        version: 1,
        unit: 's',
        value: 30,
        pos: savedHold.cfg.pos,
    });
});

test('指定规则 ID 的完整图已存在时校正规则配置且不重复创建', async () => {
    const calls: string[] = [];
    const existing = { id: '1234567890123', nodes: [{ id: 'start', type: 'onLoad', cfg: { name: 'onLoad', version: 1 }, props: {}, inputs: {}, outputs: { output: [] } }], cfg: { enable: true } };
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            calls.push(method);
            if (method === 'getGraphList') return [{ id: '1234567890123' }];
            if (method === 'getVarScopeList') return { scopes: [] };
            if (method === 'getGraph') return existing;
            if (method === 'setGraph') return undefined;
            throw new Error(`意外的方法 ${method}`);
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        graphId: '1234567890123',
        name: 'Idempotent Graph',
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, true);
    assert.equal(result.success ? result.data?.graphId : '', '1234567890123');
    assert.deepEqual(calls, ['getGraphList', 'getVarScopeList', 'getGraph', 'setGraph']);
});

test('固定规则 ID 遇到 setup 外壳时补齐变量并写入正式图', async () => {
    const calls: Array<{ method: string; input: any }> = [];
    const variables: Record<string, { type: string }> = { existing: { type: 'number' } };
    const gateway = {
        async callApi(method: string, input: any): Promise<unknown> {
            calls.push({ method, input });
            if (method === 'getGraphList') return [{ id: '1234567890123' }];
            if (method === 'getVarScopeList') return { scopes: ['R1234567890123'] };
            if (method === 'getGraph') return { id: '1234567890123', nodes: [{ id: 'setup', type: 'onLoad', cfg: { name: 'onLoad', version: 1 }, props: {}, inputs: {}, outputs: { output: [] } }], cfg: { enable: false } };
            if (method === 'getVarList') return variables;
            if (method === 'createVar') variables[input.id] = { type: input.type };
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        graphId: '1234567890123',
        name: 'Resume Shell',
        variables: [
            { id: 'existing', type: 'number', value: 0 },
            { id: 'missing', type: 'number', value: 0 },
        ],
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, true);
    assert.deepEqual(calls.filter((call) => call.method === 'createVar').map((call) => call.input.id), ['missing']);
    assert.equal(calls.filter((call) => call.method === 'setGraph').length, 1);
});

test('恢复 setup 外壳时兼容数组形式变量列表', async () => {
    const created: string[] = [];
    const gateway = {
        async callApi(method: string, input: any): Promise<unknown> {
            if (method === 'getGraphList') return [{ id: '1234567890123' }];
            if (method === 'getVarScopeList') return { scopes: ['R1234567890123'] };
            if (method === 'getGraph') return { id: '1234567890123', nodes: [{ id: 'setup', type: 'onLoad', cfg: { name: 'onLoad', version: 1 }, props: {}, inputs: {}, outputs: { output: [] } }], cfg: { enable: false } };
            if (method === 'getVarList') return [{ id: 'existing', type: 'number' }];
            if (method === 'createVar') created.push(input.id);
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        graphId: '1234567890123',
        name: 'Resume Array Variables',
        variables: [
            { id: 'existing', type: 'number', value: 0 },
            { id: 'missing', type: 'number', value: 0 },
        ],
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, true);
    assert.deepEqual(created, ['missing']);
});

test('恢复已有外壳失败时只清理本次补建变量', async () => {
    const deletes: any[] = [];
    let setGraphCalls = 0;
    const gateway = {
        async callApi(method: string, input: any): Promise<unknown> {
            if (method === 'getGraphList') return [{ id: '1234567890123' }];
            if (method === 'getVarScopeList') return { scopes: ['R1234567890123'] };
            if (method === 'getGraph') return { id: '1234567890123', nodes: [{ id: 'setup', type: 'onLoad', cfg: { name: 'onLoad', version: 1 }, props: {}, inputs: {}, outputs: { output: [] } }], cfg: { enable: false } };
            if (method === 'getVarList') return { existing: { type: 'number' }, missing: { type: 'number' } };
            if (method === 'setGraph' && ++setGraphCalls === 1) throw new Error('最终写图失败');
            if (method === 'deleteVar') deletes.push(input);
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        graphId: '1234567890123',
        name: 'Resume Cleanup',
        variables: [
            { id: 'existing', type: 'number', value: 0 },
            { id: 'missing', type: 'number', value: 0 },
            { id: 'newvar', type: 'number', value: 0 },
        ],
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, false);
    assert.deepEqual(deletes, [{ scope: 'R1234567890123', id: 'newvar' }]);
});

test('固定规则 ID 被其他规则占用时拒绝覆盖', async () => {
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            if (method === 'getGraphList') return [{ id: '1234567890123' }];
            if (method === 'getVarScopeList') return { scopes: [] };
            if (method === 'getGraph') return { id: '1234567890123', nodes: [{ id: 'other', type: 'onLoad' }], cfg: { enable: true } };
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        graphId: '1234567890123',
        name: 'Collision',
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, false);
    assert.match('error' in result ? result.error : '', /占用/);
});

test('更新规则保留传入的卡片坐标和尺寸', async () => {
    let saved: any;
    const gateway = {
        async callApi(method: string, input: unknown): Promise<unknown> {
            if (method === 'getGraph') return saved || { id: '1', nodes: [], cfg: { enable: true } };
            if (method === 'getGraphList') return [{ id: '1', userData: { name: 'Layout' } }];
            if (method === 'setGraph') saved = input;
            return undefined;
        },
    } as unknown as GatewayClient;
    const pos = { x: 321, y: 654, width: 450, height: 206 };

    const result = await updateGraph(gateway, '1', {
        nodes: [{ id: 'start', type: 'onLoad', cfg: { pos }, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, true);
    assert.deepEqual(saved?.nodes[0].cfg.pos, pos);
});

test('更新节点未携带坐标时按节点 ID 继承原坐标', async () => {
    let saved: any;
    const pos = { x: 321, y: 654, width: 450, height: 206 };
    const gateway = {
        async callApi(method: string, input: unknown): Promise<unknown> {
            if (method === 'getGraph') return saved || { id: '1', nodes: [{ id: 'start', cfg: { pos } }], cfg: { enable: false } };
            if (method === 'getGraphList') return [{ id: '1', userData: { name: 'Layout' } }];
            if (method === 'setGraph') saved = input;
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await updateGraph(gateway, '1', {
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, true);
    assert.deepEqual(saved?.nodes[0].cfg.pos, pos);
});

test('更新规则未指定 enable 时保留禁用状态', async () => {
    let saved: any;
    const nodes = [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }];
    const gateway = {
        async callApi(method: string, input: unknown): Promise<unknown> {
            if (method === 'getGraph') return saved || { id: '1', nodes, cfg: { enable: false } };
            if (method === 'getGraphList') return [{ id: '1', userData: { name: 'Disabled' } }];
            if (method === 'setGraph') saved = input;
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await updateGraph(gateway, '1', { name: 'Still Disabled' });

    assert.equal(result.success, true);
    assert.equal(saved?.cfg.enable, false);
});

test('更新旧规则缺少 cfg 时从列表保留启用状态', async () => {
    let saved: any;
    const nodes = [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }];
    const gateway = {
        async callApi(method: string, input: unknown): Promise<unknown> {
            if (method === 'getGraph') return saved || { id: '1', nodes };
            if (method === 'getGraphList') return [{ id: '1', enable: true, userData: { name: 'Legacy' } }];
            if (method === 'setGraph') saved = input;
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await updateGraph(gateway, '1', { name: 'Still Enabled' });

    assert.equal(result.success, true);
    assert.equal(saved?.cfg.enable, true);
});

test('更新规则写入后回读不一致时不报告成功', async () => {
    const calls: string[] = [];
    const nodes = [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }];
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            calls.push(method);
            if (method === 'getGraph') {
                return calls.filter((call) => call === 'getGraph').length === 1
                    ? { id: '1', nodes, cfg: { enable: true } }
                    : { id: '1', nodes, cfg: { enable: false } };
            }
            if (method === 'getGraphList') return [{ id: '1', enable: true, userData: { name: 'Verification' } }];
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await updateGraph(gateway, '1', { enable: true });

    assert.equal(result.success, false);
    assert.match('error' in result ? result.error : '', /写入结果未确认.*启用状态不一致/);
    assert.deepEqual(calls, ['getGraph', 'getGraphList', 'setGraph', 'getGraph']);
});

test('创建规则一次登记本规则变量并替换 rule 作用域', async () => {
    const calls: Array<{ method: string; input: any }> = [];
    const variables: Record<string, any> = {};
    const gateway = {
        async callApi(method: string, input: any): Promise<unknown> {
            calls.push({ method, input });
            if (method === 'createVar') variables[input.id] = { type: input.type, value: input.value, userData: input.userData };
            if (method === 'getVarList') return variables;
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'One Call Variables',
        enable: false,
        variables: [{ id: 'result', type: 'number', value: 0, name: 'Result' }],
        nodes: [{
            id: 'calc', type: 'varSetNumber', cfg: {},
            props: { id: 'result', scope: 'rule', elements: [{ type: 'const', value: '1' }] },
            inputs: { input: null }, outputs: { output: [] },
        }],
    });

    assert.equal(result.success, true);
    const graphId = result.success ? result.data!.graphId : '';
    assert.equal(calls.filter((call) => call.method === 'setGraph').length, 2);
    assert.deepEqual(calls.find((call) => call.method === 'createVar')?.input, {
        scope: `R${graphId}`, id: 'result', type: 'number', value: 0, userData: { name: 'Result' },
    });
    const saved = calls.filter((call) => call.method === 'setGraph').at(-1)!.input;
    assert.equal(saved.nodes[0].props.scope, `R${graphId}`);
});

test('本规则变量创建后校验失败会清理变量和规则外壳', async () => {
    const calls: Array<{ method: string; input: any }> = [];
    const gateway = {
        async callApi(method: string, input: any): Promise<unknown> {
            calls.push({ method, input });
            if (method === 'getVarList') return {};
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'Rollback Variables',
        enable: false,
        variables: [{ id: 'result', type: 'number', value: 0 }],
        nodes: [{
            id: 'calc', type: 'varSetNumber', cfg: {},
            props: { id: 'missing', scope: 'rule', elements: [{ type: 'const', value: '1' }] },
            inputs: { input: null }, outputs: { output: [] },
        }],
    });

    assert.equal(result.success, false);
    assert.deepEqual(calls.slice(-2).map((call) => call.method), ['deleteGraph', 'deleteVar']);
});

test('createVar 成功后响应异常仍会尝试清理该变量', async () => {
    const calls: Array<{ method: string; input: any }> = [];
    const gateway = {
        async callApi(method: string, input: any): Promise<unknown> {
            calls.push({ method, input });
            if (method === 'createVar') throw new Error('提交后响应丢失');
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'Ambiguous Create', enable: false,
        variables: [{ id: 'result', type: 'number', value: 0 }],
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, false);
    assert.deepEqual(calls.slice(-2).map((call) => call.method), ['deleteGraph', 'deleteVar']);
    assert.deepEqual(calls.at(-1)?.input, { scope: calls.find((call) => call.method === 'createVar')?.input.scope, all: true });
});

test('规则外壳成功后响应异常仍会尝试删除外壳', async () => {
    const calls: string[] = [];
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            calls.push(method);
            if (method === 'getGraphList') return [];
            if (method === 'setGraph') throw new Error('提交后响应丢失');
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'Ambiguous Shell', enable: false,
        variables: [{ id: 'result', type: 'number', value: 0 }],
        nodes: [{ id: 'start', type: 'onLoad', cfg: {}, props: {}, inputs: {}, outputs: { output: [] } }],
    });

    assert.equal(result.success, false);
    assert.equal(calls.at(-1), 'deleteGraph');
});

test('规则回滚删除失败时保留变量并报告可能残留', async () => {
    const calls: string[] = [];
    let setCount = 0;
    let listCount = 0;
    let createdId = '';
    const gateway = {
        async callApi(method: string, input: any): Promise<unknown> {
            calls.push(method);
            if (method === 'getGraphList') return ++listCount === 1 ? [] : [{ id: createdId }];
            if (method === 'getVarScopeList') return { scopes: [] };
            if (method === 'getVarList') return { result: { type: 'number', value: 0, userData: { name: 'result' } } };
            if (method === 'setGraph') {
                createdId = input.id;
                if (++setCount === 2) throw new Error('最终响应丢失');
            }
            if (method === 'deleteGraph') throw new Error('删除失败');
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'Rollback Failure', enable: false,
        variables: [{ id: 'result', type: 'number', value: 0 }],
        nodes: [{ id: 'calc', type: 'varSetNumber', cfg: {}, props: { id: 'result', scope: 'rule', elements: [{ type: 'const', value: '1' }] }, inputs: { input: null }, outputs: { output: [] } }],
    });

    assert.equal(result.success, false);
    assert.match('error' in result ? result.error : '', /可能残留规则/);
    assert.equal(calls.includes('deleteVar'), false);
});

test('规则回滚删除响应丢失但回读已删除时继续清理作用域', async () => {
    const calls: string[] = [];
    let setCount = 0;
    let listCount = 0;
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            calls.push(method);
            if (method === 'getGraphList') return ++listCount === 1 ? [] : [];
            if (method === 'getVarScopeList') return { scopes: [] };
            if (method === 'getVarList') return { result: { type: 'number', value: 0, userData: { name: 'result' } } };
            if (method === 'setGraph' && ++setCount === 2) throw new Error('最终响应丢失');
            if (method === 'deleteGraph') throw new Error('删除响应丢失');
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await createGraph(gateway, {
        name: 'Rollback Confirmed', enable: false,
        variables: [{ id: 'result', type: 'number', value: 0 }],
        nodes: [{ id: 'calc', type: 'varSetNumber', cfg: {}, props: { id: 'result', scope: 'rule', elements: [{ type: 'const', value: '1' }] }, inputs: { input: null }, outputs: { output: [] } }],
    });

    assert.equal(result.success, false);
    assert.equal(calls.at(-1), 'deleteVar');
});

test('更新规则遇到未登记变量时不调用 setGraph', async () => {
    const calls: string[] = [];
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            calls.push(method);
            if (method === 'getGraph') return { id: '1', nodes: [], cfg: {} };
            if (method === 'getGraphList') return [{ id: '1', userData: { name: 'Guard' } }];
            if (method === 'getVarList') return {};
            throw new Error(`意外的方法 ${method}`);
        },
    } as unknown as GatewayClient;

    const result = await updateGraph(gateway, '1', {
        nodes: [{
            id: 'calc', type: 'varSetNumber', cfg: {},
            props: { id: 'missing', scope: 'R1', elements: [{ type: 'const', value: '1' }] },
            inputs: { input: null }, outputs: { output: [] },
        }],
    });

    assert.equal(result.success, false);
    assert.match('error' in result ? result.error : '', /变量 R1\/missing 不存在/);
    assert.equal(calls.includes('setGraph'), false);
});

test('删除规则后清理对应的本规则变量作用域', async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const gateway = {
        async callApi(method: string, input: unknown): Promise<unknown> {
            calls.push({ method, input });
            if (method === 'getVarScopeList') return { scopes: ['R123'] };
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await deleteGraph(gateway, '123');

    assert.equal(result.success, true);
    assert.deepEqual(calls, [
        { method: 'getVarScopeList', input: {} },
        { method: 'deleteGraph', input: { id: '123' } },
        { method: 'deleteVar', input: { scope: 'R123', all: true } },
    ]);
});

test('删除无本规则变量的规则时不调用 deleteVar', async () => {
    const calls: string[] = [];
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            calls.push(method);
            if (method === 'getVarScopeList') return { scopes: ['global'] };
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await deleteGraph(gateway, '123');

    assert.equal(result.success, true);
    assert.deepEqual(calls, ['getVarScopeList', 'deleteGraph']);
});

test('规则已删除但变量作用域清理失败时报告部分成功', async () => {
    const gateway = {
        async callApi(method: string): Promise<unknown> {
            if (method === 'getVarScopeList') return { scopes: ['R123'] };
            if (method === 'deleteVar') throw new Error('清理失败');
            return undefined;
        },
    } as unknown as GatewayClient;

    const result = await deleteGraph(gateway, '123');

    assert.equal(result.success, false);
    assert.match('error' in result ? result.error : '', /规则 123 已删除.*清理失败/);
});
