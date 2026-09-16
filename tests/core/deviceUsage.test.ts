import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { GatewayClient } from '../../src/core/gateway/client';
import { findDeviceUsage } from '../../src/core/tools/deviceUsage';
import type { DeviceUsageReport } from '../../src/core/types/graph';
import type { ToolResponse } from '../../src/core/types';

// Synthetic fixtures only; no gateway connection is established.
const DEVICES = { devList: {
    lampA: { name: '测试灯', model: 'test.light', modelName: '示例照明', roomName: '测试房间', online: false },
    sensorA: { name: '测试传感器', model: 'test.sensor', modelName: '示例传感器', roomName: '模拟房间' },
    unusedA: { name: '未使用设备' },
} };
const GRAPH_LIST = [
    { id: 'graphA', enable: true, userData: { name: '测试规则' } },
    { id: 'graphB', enable: false, userData: { name: '禁用规则' } },
    { id: 'graphC', userData: { name: '未知状态规则' } },
];
const GRAPHS: Record<string, unknown> = {
    graphA: { nodes: [
        { id: 'triggerA', type: 'deviceInput', props: { did: 'sensorA', siid: 2, eiid: 1 } },
        { id: 'triggerVarA', type: 'deviceInputSetVar', props: { did: 'sensorA', siid: 2, piid: 2 } },
        { id: 'readA', type: 'deviceGet', props: { did: 'lampA', siid: 2, piid: 1 } },
        { id: 'readVarA', type: 'deviceGetSetVar', props: { did: 'lampA', siid: 2, piid: 2 } },
        { id: 'writeA', type: 'deviceOutput', props: { did: 'lampA', siid: 3, aiid: 1 } },
        { id: 'otherA', type: 'delay', props: { did: 'lampA', timeout: 1000 } },
    ] },
    graphB: { nodes: [{ id: 'orphanA', type: 'deviceOutput', props: { did: 'missingA', siid: 2, piid: 1 } }] },
    graphC: { nodes: [{ id: 'writeB', type: 'deviceOutput', props: { did: 'lampA' } }] },
};

function stub(t: TestContext, override?: (method: string, params: Record<string, unknown>, timeout: number) => unknown) {
    const calls: Array<{ method: string; params: Record<string, unknown>; timeout: number }> = [];
    const gateway = new GatewayClient();
    t.mock.method(gateway, 'callApi', async (method: string, params: Record<string, unknown>, timeout: number) => {
        assert.ok(['getDevList', 'getGraphList', 'getGraph'].includes(method), 'scanner must stay read-only');
        assert.ok(timeout > 0 && timeout <= 10_000);
        calls.push({ method, params, timeout });
        if (override) return override(method, params, timeout);
        return response(method, params);
    });
    return { gateway, calls };
}

function response(method: string, params: Record<string, unknown>): unknown {
    if (method === 'getDevList') return DEVICES;
    if (method === 'getGraphList') return GRAPH_LIST;
    return GRAPHS[String(params.id)];
}

function report(result: ToolResponse<DeviceUsageReport>): DeviceUsageReport {
    if (!result.success) throw new Error(result.error);
    assert.ok(result.data);
    return result.data;
}

test('设备引用覆盖五类节点和三种角色，保留禁用/未知状态且不依赖节点 cfg', async (t) => {
    const { gateway, calls } = stub(t);
    const data = report(await findDeviceUsage(gateway, { dids: ['lampA', 'sensorA', 'missingA'] }));
    assert.equal(data.complete, true);
    assert.equal(data.totalGraphs, 3);
    assert.equal(data.scannedGraphs, 3);
    assert.deepEqual(data.devices.map((device) => device.nodeCount), [4, 2, 1]);
    const lamp = data.devices[0];
    assert.equal(lamp.found, true, 'offline is not missing');
    assert.deepEqual(lamp.graphs[0].nodes.map((node) => node.role), ['read', 'read', 'write']);
    assert.equal(lamp.graphs[0].nodes[2].target, 'siid=3 aiid=1');
    assert.equal(lamp.graphs[0].enable, true);
    assert.equal(lamp.graphs[1].enable, null);
    assert.deepEqual(data.devices[1].graphs[0].nodes.map((node) => node.role), ['trigger', 'trigger']);
    assert.equal(data.devices[1].graphs[0].nodes[0].target, 'siid=2 eiid=1');
    assert.equal(data.devices[2].graphs[0].enable, false);
    assert.equal(data.devices[2].found, false);
    assert.deepEqual(data.orphans, [{ did: 'missingA', graphs: ['禁用规则'] }]);
    assert.equal(calls.length, 5);
});

test('query 支持名称/型号/房间/ID，忽略大小写，与显式 ID 取并集并去重', async (t) => {
    const { gateway } = stub(t);
    for (const query of ['测试灯', 'TEST.LIGHT', '示例照明', '测试房间', 'LAMPA']) {
        const data = report(await findDeviceUsage(gateway, { query: ` ${query} `, dids: [' lampA ', 'missingA', 'lampA'] }));
        assert.deepEqual(data.devices.map((device) => device.did), ['lampA', 'missingA']);
    }
});

test('无匹配时提示网页设备列表且不回显查询；已知的已移除 ID 仍可扫描', async (t) => {
    const { gateway, calls } = stub(t);
    const result = await findDeviceUsage(gateway, { query: 'synthetic-private-query' });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.error, /get_devices/);
    assert.doesNotMatch(result.error, /synthetic-private-query/);
    assert.equal(calls.length, 1);
    const data = report(await findDeviceUsage(gateway, { dids: ['missingA'] }));
    assert.equal(data.devices[0].graphs.length, 1);
});

test('输入缺失、空白、错误类型或超限在发起请求前被拒绝', async (t) => {
    const { gateway, calls } = stub(t);
    for (const input of [null, undefined, {}, { dids: [] }, { dids: [' '] }, { dids: [42] }, { query: '' }, { query: 42 }, { query: 'x'.repeat(201) }, { dids: Array(101).fill('lampA') }]) {
        assert.equal((await findDeviceUsage(gateway, input)).success, false);
    }
    assert.equal(calls.length, 0);
});

test('真实空规则列表或全部成功读取的零命中可以返回完整报告', async (t) => {
    const { gateway } = stub(t);
    const data = report(await findDeviceUsage(gateway, { dids: ['unusedA'] }));
    assert.equal(data.complete, true);
    assert.equal(data.devices[0].nodeCount, 0);
    const empty = stub(t, (method, params) => method === 'getGraphList' ? [] : response(method, params));
    const emptyData = report(await findDeviceUsage(empty.gateway, { dids: ['lampA'] }));
    assert.equal(emptyData.complete, true);
    assert.equal(emptyData.scannedGraphs, 0);
    assert.equal(emptyData.totalGraphs, 0);
});

test('设备列表的空值/畸形响应不能当作设备被删除', async (t) => {
    for (const invalid of [undefined, null, {}, [], { devList: [] }, { devList: null }, { devList: { lampA: null } }, { devList: { lampA: { name: 42 } } }]) {
        const { gateway, calls } = stub(t, (method, params) => method === 'getDevList' ? invalid : response(method, params));
        const result = await findDeviceUsage(gateway, { dids: ['lampA'] });
        assert.equal(result.success, false);
        assert.equal(calls.length, 1);
    }
});

test('规则列表的空值/畸形响应/重复 ID 不能当作零条规则', async (t) => {
    for (const invalid of [undefined, null, {}, [null], [{}], [{ id: '' }], [{ id: 'x', enable: 'false' }], [{ id: 'x' }, { id: 'x' }]]) {
        const { gateway, calls } = stub(t, (method, params) => method === 'getGraphList' ? invalid : response(method, params));
        assert.equal((await findDeviceUsage(gateway, { dids: ['lampA'] })).success, false);
        assert.equal(calls.length, 2);
    }
});

test('列表读取错误不泄露网关异常原文', async (t) => {
    for (const failingMethod of ['getDevList', 'getGraphList']) {
        const { gateway } = stub(t, (method, params) => {
            if (method === failingMethod) throw new Error('synthetic-secret-marker');
            return response(method, params);
        });
        const result = await findDeviceUsage(gateway, { dids: ['lampA'] });
        assert.equal(result.success, false);
        if (result.success) continue;
        assert.match(result.error, /读取失败/);
        assert.doesNotMatch(result.error, /synthetic-secret-marker/);
    }
});

test('单条规则请求失败保留其余结果且明确标记不完整，不重试', async (t) => {
    const { gateway, calls } = stub(t, (method, params) => {
        if (method === 'getGraph' && params.id === 'graphA') throw new Error('synthetic-secret-marker');
        return response(method, params);
    });
    const result = await findDeviceUsage(gateway, { dids: ['sensorA', 'missingA'] });
    const data = report(result);
    assert.equal(data.complete, false);
    assert.deepEqual(data.unreadableGraphs, ['graphA']);
    assert.equal(data.devices.find((device) => device.did === 'sensorA')?.nodeCount, 0);
    assert.equal(data.devices.find((device) => device.did === 'missingA')?.nodeCount, 1);
    assert.equal(calls.length, 5);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-marker/);
    if (result.success) assert.match(result.message || '', /不完整/);
});

test('畸形节点或错误规则 ID 记入未知范围，其余规则照常扫描', async (t) => {
    for (const invalid of [undefined, null, {}, { nodes: null }, { nodes: {} }, { nodes: [null] }, { nodes: ['x'] }, { nodes: [{ id: 'x', type: 'deviceOutput' }] }, { nodes: [{ id: 'x', type: 'deviceOutput', props: { did: 42 } }] }, { id: 'wrongGraph', nodes: [] }]) {
        const { gateway } = stub(t, (method, params) => method === 'getGraph' && params.id === 'graphA' ? invalid : response(method, params));
        const data = report(await findDeviceUsage(gateway, { dids: ['lampA'] }));
        assert.equal(data.complete, false);
        assert.deepEqual(data.unreadableGraphs, ['graphA']);
        assert.equal(data.devices[0].nodeCount, 1);
    }
});

test('启用状态缺失时可回退规则 cfg；禁止误报禁用', async (t) => {
    const { gateway } = stub(t, (method, params) => method === 'getGraph' && params.id === 'graphC'
        ? { cfg: { enable: true }, nodes: [{ id: 'x', type: 'deviceOutput', props: { did: 'lampA' } }] }
        : response(method, params));
    assert.equal(report(await findDeviceUsage(gateway, { dids: ['lampA'] })).devices[0].graphs[1].enable, true);
});

test('30 秒总预算会缩短后续请求超时，剩余规则记为 skipped', async (t) => {
    let now = 0;
    t.mock.method(Date, 'now', () => now);
    const { gateway, calls } = stub(t, (method, params, timeout) => {
        if (method === 'getDevList') { now += 2500; return DEVICES; }
        if (method === 'getGraphList') { now += 2500; return [...GRAPH_LIST, { id: 'graphD' }]; }
        now += timeout;
        return response(method, params);
    });
    const data = report(await findDeviceUsage(gateway, { dids: ['lampA'] }));
    assert.equal(data.complete, false);
    assert.equal(data.totalGraphs, 4);
    assert.equal(data.scannedGraphs, 3);
    assert.deepEqual(data.skippedGraphs, ['graphD']);
    assert.deepEqual(calls.slice(2).map((call) => call.timeout), [10000, 10000, 5000]);
});

test('扫描取消后不再发起新请求，剩余规则保持未确认', async (t) => {
    const controller = new AbortController();
    const { gateway, calls } = stub(t, (method, params) => {
        if (method === 'getGraph') controller.abort();
        return response(method, params);
    });
    const data = report(await findDeviceUsage(gateway, { dids: ['lampA'] }, { signal: controller.signal }));
    assert.equal(data.complete, false);
    assert.deepEqual(data.skippedGraphs, ['graphB', 'graphC']);
    assert.equal(calls.length, 3);
    const cancelled = await findDeviceUsage(gateway, { dids: ['lampA'] }, { signal: controller.signal });
    assert.equal(cancelled.success, false);
    assert.equal(calls.length, 3);
});
