/** 只返回固定诊断文案，不把供应商响应中的凭据或请求内容带到日志。 */
export function chatFailure(error: unknown): string {
    const parts: string[] = [];
    let current = error;
    for (let depth = 0; depth < 5 && current; depth++) {
        if (typeof current === 'string') { parts.push(current); break; }
        if (typeof current !== 'object') break;
        const value = current as Record<string, unknown>;
        for (const key of ['message', 'code', 'statusCode', 'status', 'name']) {
            if (typeof value[key] === 'string' || typeof value[key] === 'number') parts.push(String(value[key]));
        }
        current = value.cause;
    }
    const text = parts.join(' ');
    if (/缺少.*配置|invalid.*url/i.test(text)) return '[CONFIG] 模型配置不完整或地址格式错误，请检查接口地址、密钥和模型名称。';
    if (/401|403|unauthorized|invalid.*key/i.test(text)) return '[AUTH] 模型服务拒绝认证，请检查密钥和模型访问权限。';
    if (/404|model.*not.*found/i.test(text)) return '[NOT_FOUND] 请求的接口或模型不存在，请检查接口地址和模型名称。';
    if (/429|quota|rate.limit/i.test(text)) return '[RATE_LIMIT] 模型服务限流或额度不足，请检查服务商额度。';
    if (/503|502|504|temporarily unavailable/i.test(text)) return '[UPSTREAM] 上游服务暂时不可用，请检查服务商状态或稍后再试。';
    if (/timeout|timed.?out/i.test(text)) return '[TIMEOUT] 等待响应超时，请检查网络和服务状态。';
    if (/fetch failed|failed to fetch|network|ECONN|ENOTFOUND|terminated|socket/i.test(text)) return '[NETWORK] 连接失败或响应中断，请检查网络、代理和服务是否运行。';
    return '[INTERNAL] 处理请求时发生异常，请用诊断编号核对服务日志。';
}

export function chatCompletionError(finished: boolean, text: string): string | undefined {
    if (!finished) return '[STREAM_INCOMPLETE] 响应未收到完成标记，连接可能提前关闭。操作结果未确认，请先核对规则，勿直接重复执行。';
    if (!text.trim()) return '[EMPTY_RESPONSE] 模型结束了回复，但没有返回正文。请检查模型兼容性；工具可能已执行，请先查看工具结果。';
}
