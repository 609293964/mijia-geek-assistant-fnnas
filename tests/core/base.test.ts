import assert from 'node:assert/strict';
import test from 'node:test';
import type { Graph, GraphNode } from '../../src/core/types/graph';
import { normalizeGraphNodeForWrite, validateGraph } from '../../src/core/tools/base';

function node(
    id: string,
    type: string,
    inputs: Record<string, unknown>,
    outputs: Record<string, string[]>,
    props: Record<string, unknown> = {}
): GraphNode {
    return { id, type, cfg: { name: type, version: 1 }, props, inputs, outputs };
}

function graph(nodes: GraphNode[]): Graph {
    return {
        id: 'testgraph',
        nodes,
        cfg: {
            id: 'testgraph',
            enable: false,
            uiType: 'graph',
            userData: {
                name: 'validator test',
                lastUpdateTime: 0,
                transform: { x: 0, y: 0, scale: 1, rotate: 0 },
            },
        },
    };
}

function conditionGraph(logic: GraphNode, targetPort: string): Graph {
    return graph([
        node('load', 'onLoad', {}, { output: ['cond.trigger'] }),
        node('range', 'timeRange', {}, { output: [`logic.${targetPort}`] }),
        logic,
        node('cond', 'condition', { trigger: null, condition: null }, { met: [], unmet: [] }),
    ]);
}

test('timeRange 可以连接 logicOr、logicAnd 和 logicNot 的条件输入', () => {
    const cases = [
        conditionGraph(node('logic', 'logicOr', { input0: null }, { output: ['cond.condition'] }), 'input0'),
        conditionGraph(node('logic', 'logicAnd', { input0: null, input1: null }, { output: ['cond.condition'] }), 'input1'),
        conditionGraph(node('logic', 'logicNot', { input: null }, { output: ['cond.condition'] }), 'input'),
    ];

    for (const value of cases) {
        assert.equal(validateGraph(value).some((error) => error.type === 'tr_wrong_target'), false);
    }
});

test('timeRange 连接事件端口仍然报错', () => {
    const value = graph([
        node('range', 'timeRange', {}, { output: ['cond.trigger'] }),
        node('cond', 'condition', { trigger: null, condition: null }, { met: [], unmet: [] }),
    ]);

    assert.equal(validateGraph(value).some((error) => error.type === 'tr_wrong_target' && error.level === 'error'), true);
});

test('timeRange 连接未声明的 logic 端口仍然报错', () => {
    const value = conditionGraph(
        node('logic', 'logicOr', { input0: null }, { output: ['cond.condition'] }),
        'input999'
    );

    assert.equal(validateGraph(value).some((error) => error.type === 'tr_wrong_target' && error.level === 'error'), true);
});

test('logic 条件链未到达 condition.condition 时仍然报错', () => {
    const value = graph([
        node('range', 'timeRange', {}, { output: ['logic.input0'] }),
        node('logic', 'logicOr', { input0: null }, { output: ['set.input'] }),
        node('set', 'varSetNumber', { input: null }, { output: [] }),
    ]);

    assert.equal(validateGraph(value).some((error) => error.type === 'tr_wrong_target' && error.level === 'error'), true);
});

test('condition 缺少 condition 来源仍然报错', () => {
    const value = graph([
        node('load', 'onLoad', {}, { output: ['cond.trigger'] }),
        node('cond', 'condition', { trigger: null, condition: null }, { met: [], unmet: [] }),
    ]);

    assert.equal(validateGraph(value).some((error) => error.type === 'cond_no_condition' && error.level === 'error'), true);
});

test('output2 连接 state 节点仍然报错，连接 event 输入不报该错误', () => {
    const invalid = graph([
        node('get', 'varGet', { input: null }, { output: [], output2: ['range.trigger'] }),
        node('range', 'timeRange', {}, { output: [] }),
    ]);
    const valid = graph([
        node('get', 'varGet', { input: null }, { output: [], output2: ['set.input'] }),
        node('set', 'varSetNumber', { input: null }, { output: [] }),
    ]);

    assert.equal(validateGraph(invalid).some((error) => error.type === 'output2_to_state' && error.level === 'error'), true);
    assert.equal(validateGraph(valid).some((error) => error.type === 'output2_to_state'), false);
});

test('deviceGetSetVar 接受极客版 UI 生成的单 output 结构', () => {
    const value = graph([
        node('queryvar', 'deviceGetSetVar', { input: null }, { output: [] }, {
            did: 'device', siid: 2, piid: 1, dtype: 'number', id: 'value1', scope: 'global',
        }),
    ]);

    assert.deepEqual(validateGraph(value), []);
});

test('deviceOutput 必须声明 trigger 输入，不能使用 input', () => {
    const invalid = graph([
        node('fanOff', 'deviceOutput', { input: null }, { output: [] }, {
            did: 'fan', siid: 2, piid: 1, value: false,
        }),
    ]);
    const valid = graph([
        node('fanOff', 'deviceOutput', { trigger: null }, { output: [] }, {
            did: 'fan', siid: 2, piid: 1, value: false,
        }),
    ]);

    const errors = validateGraph(invalid);
    assert.equal(errors.some((error) => error.type === 'device_output_missing_trigger' && error.level === 'error'), true);
    assert.equal(errors.some((error) => error.type === 'device_output_wrong_input' && error.level === 'error'), true);
    assert.deepEqual(validateGraph(valid), []);
});

test('事件源不能直接接 logicOr，事件合并应使用 signalOr', () => {
    const invalid = graph([
        node('motion', 'deviceInput', {}, { output: ['or.input0'] }, {
            did: 'sensor', siid: 2, piid: 1, dtype: 'boolean', operator: '=', v1: true,
        }),
        node('or', 'logicOr', { input0: null }, { output: ['fan.trigger'] }),
        node('fan', 'deviceOutput', { trigger: null }, { output: [] }, {
            did: 'fan', siid: 2, piid: 1, value: true,
        }),
    ]);
    const valid = graph([
        node('motion', 'deviceInput', {}, { output: ['or.input0'] }, {
            did: 'sensor', siid: 2, piid: 1, dtype: 'boolean', operator: '=', v1: true,
        }),
        node('or', 'signalOr', { input0: null }, { output: ['fan.trigger'] }),
        node('fan', 'deviceOutput', { trigger: null }, { output: [] }, {
            did: 'fan', siid: 2, piid: 1, value: true,
        }),
    ]);

    assert.equal(validateGraph(invalid).some((error) => error.type === 'event_to_state_logic' && error.level === 'error'), true);
    assert.equal(validateGraph(valid).some((error) => error.type === 'event_to_state_logic'), false);
});

test('signalOr 输入必须使用连续的 inputN 且值为 null', () => {
    const invalid = graph([
        node('or', 'signalOr', { input1: true }, { output: [] }),
    ]);

    const errors = validateGraph(invalid);
    assert.equal(errors.some((error) => error.type === 'non_contiguous_inputs'), true);
    assert.equal(errors.some((error) => error.type === 'signal_input_not_null'), true);
});

test('statusLast 没有状态来源时拒绝创建，避免规则保存后永远不触发', () => {
    const value = graph([
        node('hold', 'statusLast', { input: null }, { output: ['fan.trigger'] }, { timeout: 30000 }),
        node('fan', 'deviceOutput', { trigger: null }, { output: [] }, {
            did: 'fan', siid: 2, piid: 1, value: true,
        }),
    ]);

    assert.equal(validateGraph(value).some((error) => error.type === 'status_last_no_input' && error.level === 'error'), true);
});

test('statusLast 卡片展示字段必须与运行时 timeout 一致', () => {
    const source = node('source', 'onLoad', {}, { output: ['hold.input'] });
    const missingDisplay = graph([
        source,
        node('hold', 'statusLast', { input: null }, { output: [] }, { timeout: 30000 }),
    ]);
    const valid = graph([
        source,
        {
            ...node('hold', 'statusLast', { input: null }, { output: [] }, { timeout: 30000 }),
            cfg: { name: 'statusLast', version: 1, unit: 's', value: 30 },
        },
    ]);

    assert.equal(validateGraph(missingDisplay).some((error) => error.type === 'status_last_missing_display'), true);
    assert.equal(validateGraph(valid).some((error) => error.type.startsWith('status_last_')), false);
});

test('写入前可从 timeout 自动补齐 statusLast 的卡片展示字段', () => {
    const normalized = normalizeGraphNodeForWrite(node(
        'hold',
        'statusLast',
        { input: null },
        { output: [] },
        { timeout: 120000 },
    ));

    assert.deepEqual(normalized.cfg, { name: 'statusLast', version: 1, unit: 'min', value: 2 });
});
