import {
    findMijiaPasscodeValue,
    MijiaPasscodeRequestConfig,
    normalizeMijiaPasscodeConfig,
} from '@/lib/mijiaPasscode';

const requestTimeoutMs = 30000;
const maxRequestBodyLength = 1024 * 1024;
const maxResponsePreviewLength = 6000;
const allowedProxyHosts = ['mijia.tech', 'api.io.mi.com'];

export class PasscodeRequestError extends Error {
    constructor(public statusCode: number, message: string) {
        super(message);
    }
}

function isAllowedProxyHost(hostname: string): boolean {
    const normalizedHostname = hostname.replace(/\.$/, '').toLowerCase();
    return allowedProxyHosts.some((allowedHost) => (
        normalizedHostname === allowedHost || normalizedHostname.endsWith(`.${allowedHost}`)
    ));
}

export function validatePasscodeProxyUrl(targetUrl: string): URL {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(targetUrl);
    } catch {
        throw new PasscodeRequestError(400, '请求地址格式不正确');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new PasscodeRequestError(400, '只允许 http/https 请求地址');
    }

    if (!isAllowedProxyHost(parsedUrl.hostname)) {
        throw new PasscodeRequestError(403, `只允许请求 ${allowedProxyHosts.join(', ')}`);
    }

    parsedUrl.hash = '';
    return parsedUrl;
}

function appendHeaderIfPresent(headers: Headers, name: string, value: string): void {
    const normalizedValue = value.trim();
    if (!normalizedValue || /[\r\n]/.test(normalizedValue)) return;
    headers.set(name, normalizedValue);
}

function buildProxyHeaders(config: MijiaPasscodeRequestConfig, targetUrl: URL): Headers {
    const headers = new Headers({
        'domain-refer': targetUrl.host,
    });

    appendHeaderIfPresent(headers, 'Accept', config.accept);
    appendHeaderIfPresent(headers, 'Content-Type', config.contentType);
    appendHeaderIfPresent(headers, 'User-Agent', config.userAgent);
    appendHeaderIfPresent(headers, 'Accept-Language', config.acceptLanguage);
    appendHeaderIfPresent(headers, 'Cookie', config.cookie);
    appendHeaderIfPresent(headers, 'operate-common', config.operateCommon);
    appendHeaderIfPresent(headers, 'Origin-From', config.originFrom);
    appendHeaderIfPresent(headers, 'X-XIAOMI-PROTOCAL-FLAG-CLI', config.xiaomiProtocolFlagCli);
    appendHeaderIfPresent(headers, 'MIOT-REQUEST-MODEL', config.miotRequestModel);

    return headers;
}

function parseJsonOrNull(text: string): unknown {
    const trimmedText = text.trim();
    if (!trimmedText || !/^[\[{]/.test(trimmedText)) return null;
    try {
        return JSON.parse(trimmedText);
    } catch {
        return null;
    }
}

export interface PasscodeRequestResult {
    success: boolean;
    passcode?: string;
    statusCode?: number;
    message: string;
    responsePreview?: string;
}

export async function requestMijiaPasscode(
    input: Partial<MijiaPasscodeRequestConfig>,
    cookieOverride?: string,
): Promise<PasscodeRequestResult> {
    const config = normalizeMijiaPasscodeConfig({
        ...input,
        ...(typeof cookieOverride === 'string' ? {cookie: cookieOverride} : {}),
    });
    const targetUrl = validatePasscodeProxyUrl(config.requestUrl);
    const requestBody = config.passcodeRequestBody;

    if (!requestBody) {
        throw new PasscodeRequestError(400, '请先填写登录码 POST 数据');
    }
    if (requestBody.length > maxRequestBodyLength) {
        throw new PasscodeRequestError(413, '登录码 POST 数据过大');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: buildProxyHeaders(config, targetUrl),
            body: requestBody,
            signal: controller.signal,
        });
        const responseText = await response.text();
        const parsedJson = parseJsonOrNull(responseText);
        const passcode = findMijiaPasscodeValue(parsedJson ?? responseText);

        if (passcode) {
            return {
                success: true,
                passcode,
                statusCode: response.status,
                message: '登录码已获取',
            };
        }

        return {
            success: false,
            statusCode: response.status,
            message: response.ok ? '响应中未找到 6 位登录码' : `米家接口返回 ${response.status}`,
            responsePreview: responseText.slice(0, maxResponsePreviewLength),
        };
    } catch (error) {
        if (error instanceof PasscodeRequestError) throw error;
        const message = error instanceof Error && error.name === 'AbortError'
            ? '请求超时'
            : error instanceof Error ? error.message : '请求失败';
        return {
            success: false,
            message,
        };
    } finally {
        clearTimeout(timeout);
    }
}
