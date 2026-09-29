/**
 * Session 详情 API
 * 获取和更新单个 Session
 */

import {NextRequest, NextResponse} from 'next/server';
import {getSessionStore} from '@/server/session/store';
import {z} from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/[id]
 * 获取 Session 详情和消息历史
 */
export async function GET(
    request: NextRequest,
    {params}: { params: { id: string } }
) {
    try {
        const {id} = params;
        const store = getSessionStore();

        const session = await store.getSessionMeta(id);
        if (!session) {
            return NextResponse.json({
                success: false,
                error: 'Session 不存在',
            }, {status: 404});
        }

        const messages = await store.getMessages(id);

        return NextResponse.json({
            success: true,
            session,
            messages,
        });
    } catch (error) {
        console.error('获取 Session 详情失败:', error);
        return NextResponse.json({
            success: false,
            error: '获取 Session 详情失败',
            message: error instanceof Error ? error.message : '未知错误',
        }, {status: 500});
    }
}

/**
 * PATCH /api/sessions/[id]
 * 更新 Session（如修改标题）
 */
export async function PATCH(
    request: NextRequest,
    {params}: { params: { id: string } }
) {
    try {
        const {id} = params;
        const text = await request.text();
        if (!text) {
            return NextResponse.json({success: false, error: '请求体为空'}, {status: 400});
        }
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            return NextResponse.json({success: false, error: '无效的 JSON'}, {status: 400});
        }
        const parsed = z.object({
            title: z.string().trim().min(1).max(80).optional(),
            isActive: z.boolean().optional(),
        }).strict().refine(value => value.title !== undefined || value.isActive !== undefined).safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({success: false, error: '更新内容无效'}, {status: 400});
        }
        const {title, isActive} = parsed.data;

        const store = getSessionStore();
        const session = await store.getSessionMeta(id);

        if (!session) {
            return NextResponse.json({
                success: false,
                error: 'Session 不存在',
            }, {status: 404});
        }

        const updates: any = {};
        if (title !== undefined) updates.title = title;
        if (isActive !== undefined) updates.isActive = isActive;

        await store.updateSessionMeta(id, updates);

        return NextResponse.json({
            success: true,
            message: 'Session 已更新',
        });
    } catch (error) {
        console.error('更新 Session 失败:', error);
        return NextResponse.json({
            success: false,
            error: '更新 Session 失败',
            message: error instanceof Error ? error.message : '未知错误',
        }, {status: 500});
    }
}

/**
 * POST /api/sessions/[id]
 * 支持 action: fork - 复制历史创建分支；保留旧 truncate 供已有调用方使用。
 */
export async function POST(
    request: NextRequest,
    {params}: { params: { id: string } }
) {
    try {
        const {id} = params;
        const text = await request.text();
        if (!text) {
            return NextResponse.json({
                success: false,
                error: '请求体为空',
            }, {status: 400});
        }
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            return NextResponse.json({
                success: false,
                error: '请求体不是有效的 JSON',
            }, {status: 400});
        }
        const parsed = z.discriminatedUnion('action', [
            z.object({action: z.literal('fork'), seq: z.number().int().nonnegative()}),
            z.object({action: z.literal('truncate'), seq: z.number().int().min(-1)}),
        ]).safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({success: false, error: '无效的操作或 seq 参数'}, {status: 400});
        }
        const {action, seq} = parsed.data;

        const store = getSessionStore();
        if (action === 'fork') {
            const source = await store.getSessionMeta(id);
            if (!source) return NextResponse.json({success: false, error: '原对话不存在'}, {status: 404});
            const sourceMessages = await store.getMessages(id);
            if (sourceMessages.find(item => item.seq === seq)?.role !== 'user') {
                return NextResponse.json({success: false, error: '只能从有效的用户消息创建分支'}, {status: 400});
            }
            const branch = await store.forkSession(id, seq);
            return NextResponse.json({success: true, ...branch});
        }

        if (action === 'truncate') {
            await store.truncateSession(id, seq);

            // 返回截断后的消息
            const messages = await store.getMessages(id);
            return NextResponse.json({
                success: true,
                messages,
            });
        }

        return NextResponse.json({success: false, error: '未知的 Session 操作'}, {status: 400});

    } catch (error) {
        console.error('Session POST 操作失败:', error);
        return NextResponse.json({
            success: false,
            error: '操作失败',
            message: error instanceof Error ? error.message : '未知错误',
        }, {status: 500});
    }
}

/**
 * DELETE /api/sessions/[id]
 * 删除 Session
 */
export async function DELETE(
    request: NextRequest,
    {params}: { params: { id: string } }
) {
    try {
        const {id} = params;
        const store = getSessionStore();

        await store.deleteSession(id);

        return NextResponse.json({
            success: true,
            message: 'Session 已删除',
        });
    } catch (error) {
        console.error('删除 Session 失败:', error);
        return NextResponse.json({
            success: false,
            error: '删除 Session 失败',
            message: error instanceof Error ? error.message : '未知错误',
        }, {status: 500});
    }
}
