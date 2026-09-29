import {NextRequest, NextResponse} from 'next/server';
import {
    normalizeMijiaPasscodeConfig,
} from '@/lib/mijiaPasscode';
import {
    PasscodeRequestError,
    requestMijiaPasscode,
} from '@/server/auth/passcode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/passcode
 * 使用 HAR/curl 中提取的请求参数代理请求米家接口，并提取 6 位登录码。
 */
export async function POST(request: NextRequest) {
    try {
        const payload = await request.json();
        const config = normalizeMijiaPasscodeConfig(payload?.config || payload || {});
        const result = await requestMijiaPasscode(config);
        return NextResponse.json(result, {status: result.success || result.statusCode === 200 ? 200 : 502});
    } catch (error) {
        const message = error instanceof Error ? error.message : '请求失败';
        return NextResponse.json({
            success: false,
            message,
        }, {status: error instanceof PasscodeRequestError ? error.statusCode : 500});
    }
}
