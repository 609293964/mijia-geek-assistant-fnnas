/** 只返回固定诊断文案和可信状态码，不回显供应商响应、请求内容或凭据。 */
export function chatFailure(error: unknown, stage: 'input' | 'configuration' | 'session' | 'model' | 'tool' = 'model'): string {
    const parts: string[] = [];
    let status: number | undefined;
    let sdkError: string | undefined;
    let errorType: string | undefined;
    let current = error;
    for (let depth = 0; depth < 5 && current; depth++) {
        if (typeof current === 'string') { parts.push(current); break; }
        if (typeof current !== 'object') break;
        const value = current as Record<string, unknown>;
        for (const key of ['message', 'code', 'name']) {
            if (typeof value[key] === 'string' || typeof value[key] === 'number') parts.push(String(value[key]));
        }
        for (const key of ['statusCode', 'status']) {
            const candidate = value[key];
            if (status === undefined && (typeof candidate === 'number' || typeof candidate === 'string')
                && /^(?:[1-5]\d{2})$/.test(String(candidate))) status = Number(candidate);
        }
        if (!sdkError && typeof value.name === 'string' && /^AI_[A-Za-z]+Error$/.test(value.name)) {
            sdkError = value.name;
        }
        if (!errorType && typeof value.name === 'string'
            && ['TypeError', 'SyntaxError', 'RangeError', 'AbortError'].includes(value.name)) {
            errorType = value.name;
        }
        current = value.cause;
    }
    const text = parts.join(' ');
    if (/缺少.*配置|invalid.*url/i.test(text)) return '[CONFIG] 模型配置不完整或地址格式错误，请检查接口地址、密钥和模型名称。';
    if (status === 401 || status === 403 || /unauthorized|invalid.*key/i.test(text)) return '[AUTH] 模型服务拒绝认证，请检查密钥和模型访问权限。';
    if (status === 404 || /model.*not.*found/i.test(text)) return '[NOT_FOUND] 请求的接口或模型不存在，请检查接口地址和模型名称。';
    if (status === 429 || /quota|rate.limit/i.test(text)) return '[RATE_LIMIT] 模型服务限流或额度不足，请检查服务商额度。';
    if (/context.length|maximum context|too many tokens|token limit/i.test(text)) return '[CONTEXT_LIMIT] 对话上下文超过模型限制；请新建对话或缩短输入。若之前调用过工具，先核对结果。';
    if (status === 408) return '[TIMEOUT] 模型接口返回 HTTP 408；请求等待超时，请检查服务商及代理超时配置。';
    if (status === 413) return '[REQUEST_TOO_LARGE] 模型接口拒绝过大的请求（HTTP 413）；请缩短对话或减少图片。';
    if (status === 400 || status === 422) return `[BAD_REQUEST] 模型接口拒绝请求（HTTP ${status}）；可能是模型不支持工具或图片、上下文过长，或接口参数不兼容。请用新对话排除历史影响并检查模型能力；先核对已执行的工具。`;
    if (status === 502 || status === 503 || status === 504 || /temporarily unavailable/i.test(text)) return '[UPSTREAM] 上游服务暂时不可用，请检查服务商状态或稍后再试。';
    if (status !== undefined && status >= 500) return `[UPSTREAM] 模型服务返回 HTTP ${status}；请检查服务商或中转服务状态。已执行的工具结果需先核对。`;
    if (status !== undefined && status >= 400) return `[REQUEST_REJECTED] 模型接口返回 HTTP ${status}；请求未被正常处理，请核对服务商的接口、模型权限和请求限制。已执行的工具需先核对。`;
    if (/timeout|timed.?out/i.test(text)) return '[TIMEOUT] 等待响应超时，请检查网络和服务状态。';
    if (/fetch failed|failed to fetch|network|ECONN|ENOTFOUND|terminated|socket/i.test(text)) return '[NETWORK] 连接失败或响应中断，请检查网络、代理和服务是否运行。';
    if (sdkError === 'AI_InvalidToolArgumentsError' || sdkError === 'AI_NoSuchToolError') {
        return '[TOOL_CALL] 模型生成的工具调用名称或参数不符合应用定义；请换用支持工具调用的模型，或简化本次请求。不要直接重复可能已执行的操作。';
    }
    if (sdkError === 'AI_JSONParseError' || sdkError === 'AI_TypeValidationError' || sdkError === 'AI_InvalidResponseDataError') {
        return '[MODEL_RESPONSE] 模型接口返回的数据格式无法解析；请检查接口的 OpenAI 兼容性和流式响应实现。先核对可能已执行的工具。';
    }
    if (sdkError === 'AI_UnsupportedFunctionalityError') {
        return '[MODEL_CAPABILITY] 当前模型或接口不支持请求的功能（如工具或图片）；请检查模型能力。';
    }
    if (stage === 'session') return '[SESSION] 加载或保存对话历史失败；请检查应用数据目录的空间与读写权限，暂勿重复可能已执行的操作。';
    if (stage === 'configuration') return '[CONFIG] 创建模型实例失败；请核对接口地址、模型名称和应用配置。';
    if (stage === 'input') return '[INPUT] 无法解析本次请求；请检查消息或图片格式，缩小附件后重试。';
    if (stage === 'tool') return '[TOOL] 工具执行或结果处理发生异常；请先核对设备、规则和变量状态，再决定是否重试。';
    return `[INTERNAL] 模型请求或响应处理发生未归类的异常${errorType ? `（类型：${errorType}）` : ''}；为保护凭据和设备信息，无法直接显示原始错误。请记录诊断编号及是否使用工具/图片，先核对可能已执行的操作。`;
}

export function chatCompletionError(finished: boolean, text: string): string | undefined {
    if (!finished) return '[STREAM_INCOMPLETE] 响应未收到完成标记，连接可能提前关闭。操作结果未确认，请先核对规则，勿直接重复执行。';
    if (!text.trim()) return '[EMPTY_RESPONSE] 模型结束了回复，但没有返回正文。请检查模型兼容性；工具可能已执行，请先查看工具结果。';
}
