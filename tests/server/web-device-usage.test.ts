import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoreTool } from 'ai';
import type { Schema } from '@ai-sdk/ui-utils';
import { z } from 'zod';
import { GatewayClient, findDeviceUsageInputSchema, type ToolResponse, type DeviceUsageReport } from '../../src/core';
import { createCoreTools } from '../../src/server/ai/tools-adapter';

// The legacy defineTool wrapper erases result types; pin the expected contract
// here, and verify its actual validator and execution result below.
type ScanTool = CoreTool<Schema<z.infer<typeof findDeviceUsageInputSchema>>, ToolResponse<DeviceUsageReport>>;

test('Web 设备引用工具复用输入校验并支持按名称只读扫描', async (t) => {
    const calls: string[] = [];
    const gateway = new GatewayClient();
    t.mock.method(gateway, 'callApi', async (method: string) => {
        calls.push(method);
        if (method === 'getDevList') return { devList: { exampleLamp: { name: '示例灯' } } };
        if (method === 'getGraphList') return [{ id: 'exampleGraph', enable: false }];
        if (method === 'getGraph') return { nodes: [{ id: 'outputA', type: 'deviceOutput', props: { did: 'exampleLamp', siid: 2, piid: 1 } }] };
        throw new Error('非预期的网关调用');
    });
    const scan = createCoreTools(gateway).find_device_usage as ScanTool;
    // defineTool exposes the shared Zod validator through the SDK JSON schema.
    const parameters = scan.parameters;
    assert.ok(parameters.validate);
    assert.equal((await parameters.validate({})).success, false);
    assert.equal((await parameters.validate({ query: ' ' })).success, false);
    assert.equal((await parameters.validate({ dids: [42] })).success, false);
    assert.equal((await parameters.validate({ query: '示例灯' })).success, true);
    assert.ok(scan.execute);
    const result = await scan.execute({ query: '示例灯' }, {});
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.data?.complete, true);
    assert.equal(result.data?.devices[0].graphs[0].enable, false);
    assert.equal(result.data?.devices[0].graphs[0].nodes[0].role, 'write');
    assert.deepEqual(calls, ['getDevList', 'getGraphList', 'getGraph']);
});

test('Web 工具将取消信号传给扫描器', async (t) => {
    const gateway = new GatewayClient();
    t.mock.method(gateway, 'callApi', () => assert.fail('已取消的扫描不应访问网关'));
    const controller = new AbortController();
    controller.abort();
    const scan = createCoreTools(gateway).find_device_usage as ScanTool;
    assert.ok(scan.execute);
    const result = await scan.execute({ dids: ['exampleLamp'] }, { abortSignal: controller.signal });
    assert.equal(result.success, false);
});
