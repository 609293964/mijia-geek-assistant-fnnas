import assert from 'node:assert/strict';
import test from 'node:test';
import {chatCompletionError, chatFailure} from '../../src/lib/chat-diagnostics';

test('空白完成和无完成标记的部分文本均不能报告成功', () => {
    assert.match(chatCompletionError(true, ' \n') || '', /EMPTY_RESPONSE/);
    assert.match(chatCompletionError(false, '已开始') || '', /STREAM_INCOMPLETE/);
    assert.equal(chatCompletionError(true, '已完成'), undefined);
});

test('诊断按供应商状态和网络原因分类且不透传响应内容', () => {
    for (const [statusCode, category] of [[401, 'AUTH'], [404, 'NOT_FOUND'], [429, 'RATE_LIMIT'], [503, 'UPSTREAM']] as const) {
        const message = chatFailure({statusCode, message: 'private request payload'});
        assert.match(message, new RegExp(category));
        assert.doesNotMatch(message, /private request payload/);
    }
    assert.match(chatFailure(new Error('fetch failed', {cause: {code: 'ENOTFOUND'}})), /NETWORK/);
    assert.match(chatFailure(new Error('缺少 API Key 配置')), /CONFIG/);
    assert.match(chatFailure({name: 'TimeoutError'}), /TIMEOUT/);
    assert.doesNotMatch(chatFailure('private request payload'), /private request payload/);
});
