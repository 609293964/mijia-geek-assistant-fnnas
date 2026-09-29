import assert from 'node:assert/strict';
import test from 'node:test';
import {exportConversation, isNearChatBottom, matchesSession, toolDisplayStatus} from '../../src/lib/chat-workspace';

test('阅读旧消息时暂停跟随，接近底部时恢复', () => {
    assert.equal(isNearChatBottom(0, 1000, 400), false);
    assert.equal(isNearChatBottom(520, 1000, 400), true);
    assert.equal(isNearChatBottom(0, 200, 400), true);
});

test('历史搜索覆盖标题、摘要、空白和大小写', () => {
    const session = {title: '客厅 LED', summary: '定时开灯'};
    assert.equal(matchesSession(session, ' led '), true);
    assert.equal(matchesSession(session, '定时'), true);
    assert.equal(matchesSession(session, '   '), true);
    assert.equal(matchesSession(session, '卧室'), false);
});

test('导出仅包含可见正文，不包含图片路径和原始工具内容', () => {
    const messages = [{
        role: 'user' as const, content: '测试消息',
        images: [{name: 'private-image-name', previewUrl: 'blob:private-url'}],
        process: {args: 'private-tool-args'},
    }, {role: 'assistant' as const, content: '测试回复'}];
    const markdown = exportConversation(messages);
    assert.match(markdown, /测试消息/);
    assert.match(markdown, /测试回复/);
    assert.match(markdown, /1 张图片/);
    assert.doesNotMatch(markdown, /private-/);
});

test('未收到工具结果不得显示成功或认定失败', () => {
    assert.equal(toolDisplayStatus({success: false}, true).label, '执行中');
    assert.equal(toolDisplayStatus({success: true}, false).label, '结果未确认');
    assert.equal(toolDisplayStatus({success: false, result: {success: false}}, false).label, '失败');
    assert.equal(toolDisplayStatus({success: true, result: {}}, false).label, '已返回');
});
