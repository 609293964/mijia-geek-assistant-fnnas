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

test('常见模型请求错误提供可操作说明而不显示响应正文', () => {
    const secret = 'private request payload and API key';
    for (const statusCode of [400, 422]) {
        const failure = chatFailure({statusCode, message: secret});
        assert.match(failure, /BAD_REQUEST/);
        assert.match(failure, /工具或图片/);
        assert.doesNotMatch(failure, /private request payload|API key/);
    }
    assert.match(chatFailure({statusCode: 413, message: secret}), /REQUEST_TOO_LARGE/);
    assert.match(chatFailure({statusCode: 408, message: secret}), /TIMEOUT.*HTTP 408/);
    assert.match(chatFailure({statusCode: 409, message: secret}), /REQUEST_REJECTED.*HTTP 409/);
    assert.match(chatFailure({statusCode: 500, message: secret}), /UPSTREAM.*HTTP 500/);
    assert.match(chatFailure({statusCode: 400, message: 'maximum context length exceeded'}), /CONTEXT_LIMIT/);
});

test('SDK 错误及处理阶段区分工具、模型响应和会话问题', () => {
    assert.match(chatFailure({name: 'AI_InvalidToolArgumentsError', message: 'private args'}), /TOOL_CALL/);
    assert.match(chatFailure({name: 'AI_JSONParseError', message: 'private response'}), /MODEL_RESPONSE/);
    assert.match(chatFailure({name: 'AI_UnsupportedFunctionalityError'}), /MODEL_CAPABILITY/);
    assert.match(chatFailure(new Error('private filesystem path'), 'session'), /SESSION/);
    assert.match(chatFailure(new Error('private payload'), 'tool'), /TOOL/);
    assert.match(chatFailure(new Error('private payload'), 'configuration'), /CONFIG/);
    assert.match(chatFailure(new Error('private payload'), 'input'), /INPUT/);
    assert.doesNotMatch(chatFailure(new Error('private filesystem path'), 'session'), /private|filesystem/);
});

test('响应正文中的数字不会伪装成 HTTP 状态码', () => {
    assert.match(chatFailure({message: 'private device 401'}), /INTERNAL/);
    assert.doesNotMatch(chatFailure({statusCode: 400, message: 'private device 401'}), /AUTH/);
    assert.match(chatFailure(new TypeError('private request payload')), /INTERNAL.*TypeError/);
    assert.doesNotMatch(chatFailure(new TypeError('private request payload')), /private request payload/);
});
