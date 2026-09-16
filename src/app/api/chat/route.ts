/**
 * Chat API
 * 使用已建立的 WebSocket 连接进行对话
 */

import {NextRequest} from 'next/server';
import {getGateway, isGatewayConnected} from '@/server/gateway/shared';
import {Agent} from '@/server/agent/agent';
import {chatFailure} from '@/lib/chat-diagnostics';
import {randomUUID} from 'node:crypto';
import {getModelConfigFromEnv} from '@/server/ai/model';
import {getSessionStore} from '@/server/session/store';
import {hasValidImageSignature} from '@/server/ai/chat-images';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

function badRequest(error: string) {
    return new Response(JSON.stringify({error}), {
        status: 400,
        headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
    });
}

/**
 * POST /api/chat
 */
export async function POST(request: NextRequest) {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let stage = 'input';
    const log = (event: string, error?: string) => console.info('[ChatDiagnostic]', JSON.stringify({requestId, stage, event, elapsedMs: Date.now() - startedAt, error}));
    log('received');
    try {
        const contentType = request.headers.get('content-type') || '';
        let message = '';
        let sessionId: string | undefined;
        const images: Array<{data: Buffer; mimeType: string; name: string}> = [];

        if (contentType.includes('multipart/form-data')) {
            const form = await request.formData();
            message = String(form.get('message') || '').trim();
            sessionId = String(form.get('sessionId') || '').trim() || undefined;

            const files = form.getAll('images').filter((entry): entry is File => typeof entry !== 'string');
            if (files.length > MAX_IMAGE_COUNT) return badRequest(`一次最多上传 ${MAX_IMAGE_COUNT} 张图片`);

            let totalBytes = 0;
            for (const file of files) {
                if (!ALLOWED_IMAGE_TYPES.has(file.type)) return badRequest(`不支持的图片格式：${file.type || '未知格式'}`);
                if (file.size > MAX_IMAGE_BYTES) return badRequest(`${file.name} 超过 8 MB`);
                totalBytes += file.size;
                if (totalBytes > MAX_TOTAL_IMAGE_BYTES) return badRequest('图片总大小不能超过 20 MB');
                const data = Buffer.from(await file.arrayBuffer());
                if (!hasValidImageSignature(data, file.type)) return badRequest(`${file.name} 不是有效的图片文件`);
                images.push({
                    data,
                    mimeType: file.type,
                    name: file.name.replace(/[\r\n\0]/g, ' ').slice(0, 120) || 'image',
                });
            }
        } else {
            const body = await request.json();
            message = typeof body.message === 'string' ? body.message.trim() : '';
            sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
        }

        if (!message && images.length === 0) return badRequest('缺少消息内容或图片');

        // 检查网关连接
        if (!isGatewayConnected()) {
            return new Response(
                JSON.stringify({error: '请先登录连接网关'}),
                {status: 400, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}}
            );
        }

        // 使用已建立的连接
        const gateway = getGateway()!;
        stage = 'configuration';
        const config = getModelConfigFromEnv();
        const agent = new Agent(gateway, config);

        // 如果有 sessionId，加载历史
        if (sessionId) {
            await agent.loadSession(sessionId);
        } else {
            // 如果没有 sessionId，创建一个新的
            const store = getSessionStore();
            const newSession = await store.createSession();
            agent.setSession(newSession.id);
        }

        const encoder = new TextEncoder();
        stage = 'agent';
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const output of agent.run(message, images)) {
                        if (output.type === 'error') log('error', output.error.startsWith('[') ? output.error : chatFailure(output.error));
                        if (output.type === 'complete' || output.type === 'waiting_input') log(output.type);
                        const data = JSON.stringify({...output, requestId});
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                } catch (error) {
                    const errorMessage = chatFailure(error);
                    log('error', errorMessage);
                    const errorOutput = {type: 'error', error: errorMessage, requestId};
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorOutput)}\n\n`));
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'X-Request-ID': requestId,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error) {
        const errorMessage = chatFailure(error);
        log('error', errorMessage);
        return new Response(
            JSON.stringify({error: errorMessage, requestId}),
            {status: 500, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': requestId}}
        );
    }
}

/**
 * GET /api/chat
 */
export async function GET() {
    return new Response(
        JSON.stringify({
            status: 'ok',
            connected: isGatewayConnected(),
        }),
        {headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}}
    );
}
