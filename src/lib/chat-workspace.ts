/** UI-only helpers: never execute, retry or roll back a gateway operation. */
export function isNearChatBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
    return scrollHeight - scrollTop - clientHeight <= 80;
}

export function matchesSession(
    session: {title: string; summary: string},
    query: string,
): boolean {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${session.title}\n${session.summary}`.toLocaleLowerCase().includes(needle);
}

export function exportConversation(messages: ReadonlyArray<{
    role: 'user' | 'assistant';
    content: string;
    images?: ReadonlyArray<{name: string}>;
}>): string {
    // Export visible conversation only, not raw tool arguments, credentials or image URLs.
    return '# 米家助手对话\n\n> 仅导出可见正文；不包含图片文件、工具参数和原始结果。正文可能包含家庭信息，请勿公开分享。\n\n'
        + messages.map(msg => `## ${msg.role === 'user' ? '我' : '智者'}\n\n${msg.content}${
            msg.images?.length ? `\n\n（附有 ${msg.images.length} 张图片，未导出）` : ''
        }`).join('\n\n---\n\n') + '\n';
}

export function toolDisplayStatus(
    call: {success: boolean; result?: unknown},
    running: boolean,
): {label: string; color: string} {
    if (call.result === undefined) {
        return running ? {label: '执行中', color: 'processing'} : {label: '结果未确认', color: 'warning'};
    }
    return call.success ? {label: '已返回', color: 'success'} : {label: '失败', color: 'error'};
}
