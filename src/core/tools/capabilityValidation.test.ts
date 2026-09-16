import assert from 'node:assert/strict';
import { validateGraphCapabilities } from './capabilityValidation.js';

const device = {
  urn: 'urn:test:motion',
  properties: [{ siid: 2, piid: 2, desc: 'No Motion Duration', dtype: 'uint16', access: ['read', 'notify'], unit: 'minutes', list: [{ value: 2, description: '2 Minutes' }, { value: 5, description: '5 Minutes' }] }],
  events: [],
  actions: [],
};
const base = { id: 'n1', type: 'deviceGet', cfg: { urn: 'urn:test:motion' }, inputs: { input: null }, outputs: { output: [], output2: [] } };
const invalid = validateGraphCapabilities([{ ...base, props: { did: 'sensor', siid: 2, piid: 2, dtype: 'int', operator: '>=', v1: 50 } }], new Map([['sensor', device]]));
assert.equal(invalid.valid, false);
assert.match(invalid.errors[0].message, /枚举字段/);
const valid = validateGraphCapabilities([{ ...base, props: { did: 'sensor', siid: 2, piid: 2, dtype: 'int', operator: 'include', v1: [2] } }], new Map([['sensor', device]]));
assert.equal(valid.valid, true);
const secondsRequest = validateGraphCapabilities([
  { id: 'hold', type: 'statusLast', cfg: {}, props: { timeout: 30000 }, inputs: { input: null }, outputs: { output: [] } } as any,
], new Map([['sensor', device]]), { durationMs: 30000, intent: 'state_hold' });
assert.equal(secondsRequest.valid, true);
const wrongSecondsGraph = validateGraphCapabilities([
  { ...base, props: { did: 'sensor', siid: 2, piid: 2, dtype: 'int', operator: 'include', v1: [30] } },
], new Map([['sensor', device]]), { durationMs: 30000, intent: 'state_hold' });
assert.equal(wrongSecondsGraph.valid, false);
assert.ok(wrongSecondsGraph.errors.some((item) => item.type === 'duration_not_representable'));
const delayForHold = validateGraphCapabilities([
  { id: 'delay', type: 'delay', cfg: {}, props: { timeout: 30000 }, inputs: { input: null }, outputs: { output: [] } } as any,
], new Map([['sensor', device]]), { durationMs: 30000, intent: 'state_hold' });
assert.ok(delayForHold.errors.some((item) => item.type === 'delay_used_for_state_hold'));

const sourceNode = { id: 'hasSomeone', type: 'deviceInput', cfg: {}, props: { did: 'sensor', siid: 2, piid: 2, dtype: 'int', operator: 'include', v1: [2] }, inputs: {}, outputs: { output: ['hold30.input'] } };
const hold30 = { id: 'hold30', type: 'statusLast', cfg: {}, props: { timeout: 30000 }, inputs: { input: null }, outputs: { output: [] } };
const hold180 = { id: 'hold180', type: 'statusLast', cfg: {}, props: { timeout: 180000 }, inputs: { input: null }, outputs: { output: [] } };
const boundDuration = validateGraphCapabilities(
  [sourceNode, hold30, hold180] as any,
  new Map([['sensor', device]]),
  [
    { nodeId: 'hold30', sourceNodeId: 'hasSomeone', sourceDid: 'sensor', durationMs: 30000, intent: 'state_hold' },
    { nodeId: 'hold180', durationMs: 180000, intent: 'state_hold' },
  ],
);
assert.equal(boundDuration.valid, true);
const mismatchedDuration = validateGraphCapabilities(
  [sourceNode, hold30] as any,
  new Map([['sensor', device]]),
  { nodeId: 'hold30', durationMs: 120000, intent: 'state_hold' },
);
assert.ok(mismatchedDuration.errors.some((item) => item.type === 'duration_node_mismatch'));
const nativeExactButGatewayTimed = validateGraphCapabilities(
  [
    { id: 'occupancy', type: 'deviceInput', cfg: {}, props: { did: 'sensor', siid: 2, piid: 2, dtype: 'int', operator: 'include', v1: [2] }, inputs: {}, outputs: { output: ['holdNative.input'] } },
    { id: 'holdNative', type: 'statusLast', cfg: {}, props: { timeout: 120000 }, inputs: { input: null }, outputs: { output: [] } },
  ] as any,
  new Map([['sensor', device]]),
  { nodeId: 'holdNative', sourceNodeId: 'occupancy', durationMs: 120000, intent: 'state_hold' },
);
assert.ok(nativeExactButGatewayTimed.errors.some((item) => item.type === 'native_duration_required'));
const implicitNativeButGatewayTimed = validateGraphCapabilities(
  [
    { id: 'occupancyImplicit', type: 'deviceInput', cfg: {}, props: { did: 'sensor', siid: 2, piid: 1, dtype: 'int', operator: 'include', v1: [1] }, inputs: {}, outputs: { output: ['holdImplicit.input'] } },
    { id: 'holdImplicit', type: 'statusLast', cfg: {}, props: { timeout: 120000 }, inputs: { input: null }, outputs: { output: [] } },
  ] as any,
  new Map([['sensor', device]]),
);
assert.ok(implicitNativeButGatewayTimed.errors.some((item) => item.type === 'native_duration_required'));

const withoutCfg = validateGraphCapabilities([{ ...base, cfg: undefined, props: { did: 'sensor', siid: 2, piid: 2, dtype: 'int', operator: 'include', v1: [2] } } as any], new Map([['sensor', device]]));
assert.equal(withoutCfg.valid, true);
assert.equal(validateGraphCapabilities([{ ...base, cfg: undefined, props: undefined } as any], new Map([['sensor', device]])).errors[0].type, 'missing_props');
const speaker = {
  urn: 'urn:test:speaker',
  properties: [],
  events: [],
  actions: [{ siid: 7, aiid: 3, desc: 'Play Text', in: [{ siid: 7, piid: 1, desc: 'Text Content', dtype: 'string', access: [] }] }],
};
const playText = { id: 'tts', type: 'deviceOutput', cfg: { urn: 'urn:test:speaker' }, props: { did: 'speaker', siid: 7, aiid: 3, ins: [{ piid: 1, value: 'Close the fridge door.' }] }, inputs: { trigger: null }, outputs: { output: [] } };
assert.equal(validateGraphCapabilities([playText], new Map([['speaker', speaker]])).valid, true);
assert.equal(validateGraphCapabilities([{ ...playText, props: { ...playText.props, aiid: 99 } }], new Map([['speaker', speaker]])).valid, false);
assert.equal(validateGraphCapabilities([{ ...playText, props: { ...playText.props, ins: [{ piid: 1, value: 123 }] } }], new Map([['speaker', speaker]])).valid, false);
assert.equal(validateGraphCapabilities([{ ...playText, props: { ...playText.props, ins: [{ piid: 1, id: 'messageVar', scope: 'R1', dtype: 'string' }] } }], new Map([['speaker', speaker]])).valid, true);
assert.equal(validateGraphCapabilities([{ ...playText, props: { ...playText.props, ins: [{ piid: 1, id: 'messageVar', scope: 'R1', dtype: 'number' }] } }], new Map([['speaker', speaker]])).valid, false);

// 动作输入包含枚举或范围参数时，单个标量值有效（不得要求 operator=include）
const lamp = {
  urn: 'urn:test:lamp',
  properties: [],
  events: [],
  actions: [{ siid: 3, aiid: 15, desc: 'Apply Scene', in: [{ siid: 3, piid: 9, desc: 'Scene', dtype: 'uint8', access: [], list: [{ value: 5, description: 'Reading' }, { value: 6, description: 'Working' }] }] }, { siid: 3, aiid: 2, desc: 'Delay Off', in: [{ siid: 3, piid: 2, desc: 'Minutes', dtype: 'uint8', access: [], range: { min: 1, max: 60, step: 1 } }] }],
};
const lampMap = new Map([['lamp', lamp]]);
const scene = { id: 's', type: 'deviceOutput', cfg: { urn: 'urn:test:lamp' }, props: { did: 'lamp', siid: 3, aiid: 15, ins: [{ piid: 9, value: 5 }] }, inputs: { trigger: null }, outputs: { output: [] } };
assert.equal(validateGraphCapabilities([scene], lampMap).valid, true);
assert.equal(validateGraphCapabilities([{ ...scene, props: { ...scene.props, ins: [{ piid: 9, value: 99 }] } }], lampMap).valid, false);
const delay = { id: 'd', type: 'deviceOutput', cfg: { urn: 'urn:test:lamp' }, props: { did: 'lamp', siid: 3, aiid: 2, ins: [{ piid: 2, value: 10 }] }, inputs: { trigger: null }, outputs: { output: [] } };
assert.equal(validateGraphCapabilities([delay], lampMap).valid, true);
assert.equal(validateGraphCapabilities([{ ...delay, props: { ...delay.props, ins: [{ piid: 2, value: 999 }] } }], lampMap).valid, false);

const volumeDevice = {
  urn: 'urn:test:speaker',
  properties: [{ siid: 2, piid: 1, desc: 'Volume', dtype: 'uint8', access: ['read', 'write'], range: { min: 5, max: 100, step: 1 } }],
  events: [],
  actions: [],
};
const dynamicVolume = { id: 'volume', type: 'deviceOutput', cfg: { urn: 'urn:test:speaker' }, props: { did: 'speaker', siid: 2, piid: 1, id: 'volumeVar', scope: 'R1', dtype: 'number', min: 5, max: 100, step: 1 }, inputs: { trigger: null }, outputs: { output: [] } };
assert.equal(validateGraphCapabilities([dynamicVolume], new Map([['speaker', volumeDevice]])).valid, true);
assert.equal(validateGraphCapabilities([{ ...dynamicVolume, props: { ...dynamicVolume.props, max: 200 } }], new Map([['speaker', volumeDevice]])).valid, false);
assert.equal(validateGraphCapabilities([{ ...dynamicVolume, props: { ...dynamicVolume.props, scope: undefined } }], new Map([['speaker', volumeDevice]])).valid, false);

const boolDevice = { urn: 'urn:test:switch', properties: [{ siid: 2, piid: 1, desc: 'Power', dtype: 'bool', access: ['write'] }], events: [], actions: [] };
const boolOutput = { id: 'power', type: 'deviceOutput', cfg: { urn: 'urn:test:switch' }, props: { did: 'switch', siid: 2, piid: 1, value: true }, inputs: { trigger: null }, outputs: { output: [] } };
assert.equal(validateGraphCapabilities([boolOutput], new Map([['switch', boolDevice]])).valid, true);
assert.equal(validateGraphCapabilities([{ ...boolOutput, props: { ...boolOutput.props, value: 'true' } }], new Map([['switch', boolDevice]])).valid, false);

const enumDevice = { urn: 'urn:test:fan', properties: [{ siid: 2, piid: 2, desc: 'Mode', dtype: 'uint8', access: ['write'], list: [{ value: 1, description: 'Auto' }, { value: 2, description: 'Silent' }] }], events: [], actions: [] };
const enumOutput = { id: 'mode', type: 'deviceOutput', cfg: { urn: 'urn:test:fan' }, props: { did: 'fan', siid: 2, piid: 2, value: 1 }, inputs: { trigger: null }, outputs: { output: [] } };
assert.equal(validateGraphCapabilities([enumOutput], new Map([['fan', enumDevice]])).valid, true);
assert.equal(validateGraphCapabilities([{ ...enumOutput, props: { ...enumOutput.props, value: 9 } }], new Map([['fan', enumDevice]])).valid, false);

const lock = {
  urn: 'urn:test:lock',
  properties: [],
  events: [{ siid: 4, eiid: 1, desc: 'Unlocked', arguments: [{ siid: 4, piid: 1, desc: 'Method', dtype: 'uint8', access: [] }] }],
  actions: [],
};
const eventSetVar = { id: 'eventVar', type: 'deviceInputSetVar', cfg: { urn: 'urn:test:lock' }, props: { did: 'lock', siid: 4, eiid: 1, arguments: [{ piid: 1, dtype: 'number', scope: 'R1', id: 'method' }] }, inputs: {}, outputs: { output: [] } };
assert.equal(validateGraphCapabilities([eventSetVar], new Map([['lock', lock]])).valid, true);
assert.equal(validateGraphCapabilities([{ ...eventSetVar, props: { ...eventSetVar.props, arguments: [{ piid: 2, dtype: 'number', scope: 'R1', id: 'method' }] } }], new Map([['lock', lock]])).valid, false);
assert.equal(validateGraphCapabilities([{ ...eventSetVar, props: { ...eventSetVar.props, arguments: [{ piid: 1, dtype: 'string', scope: 'R1', id: 'method' }] } }], new Map([['lock', lock]])).valid, false);
assert.equal(validateGraphCapabilities([{ ...eventSetVar, props: { ...eventSetVar.props, arguments: [{ piid: 1, dtype: 'number', scope: 'R1', id: 'method' }, { piid: 1, dtype: 'number', scope: 'R1', id: 'method2' }] } }], new Map([['lock', lock]])).valid, false);
console.log('能力校验测试通过');
