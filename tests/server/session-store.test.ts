import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SessionStore} from '../../src/server/session/store';

test('forkSession 保留原对话并复制用户消息之前的历史', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mijia-session-'));
    try {
        const store = new SessionStore(dir);
        const source = await store.createSession('原对话');
        await store.appendMessage(source.id, {role: 'user', content: '第一问', timestamp: new Date().toISOString()});
        await store.appendMessage(source.id, {role: 'assistant', content: '第一答', timestamp: new Date().toISOString()});
        await store.appendMessage(source.id, {role: 'user', content: '第二问', timestamp: new Date().toISOString()});
        await store.appendMessage(source.id, {role: 'assistant', content: '第二答', timestamp: new Date().toISOString()});

        const branch = await store.forkSession(source.id, 2);
        assert.equal(branch.messages.length, 2);
        assert.deepEqual(branch.messages.map(message => message.content), ['第一问', '第一答']);
        assert.equal((await store.getMessages(source.id)).length, 4);
        assert.equal(branch.session.parentSessionId, source.id);
        assert.equal(branch.session.forkSeq, 2);
        assert.match(branch.session.title, /分支$/);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test('forkSession 拒绝从助手消息或不存在消息创建分支', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mijia-session-'));
    try {
        const store = new SessionStore(dir);
        const source = await store.createSession();
        await store.appendMessage(source.id, {role: 'user', content: '问题', timestamp: new Date().toISOString()});
        await store.appendMessage(source.id, {role: 'assistant', content: '回答', timestamp: new Date().toISOString()});
        await assert.rejects(() => store.forkSession(source.id, 1), /用户消息/);
        await assert.rejects(() => store.forkSession(source.id, 99), /用户消息/);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});
