import assert from 'node:assert/strict';
import test from 'node:test';
import {createGatewayManager} from '../../src/core/gateway/manager';

test('gateway manager starts disconnected without a recoverable in-memory session', async () => {
    const manager = createGatewayManager();
    assert.deepEqual(manager.getStatus(), {connected: false, reconnecting: false});
    await manager.disconnect();
    assert.deepEqual(manager.getStatus(), {connected: false, reconnecting: false});
});
