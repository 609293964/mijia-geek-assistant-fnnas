import {NextResponse} from 'next/server';
import {getGatewayStatus} from '@/server/gateway/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const status = getGatewayStatus();
    return NextResponse.json(
        {success: true, ...status},
        {headers: {'Cache-Control': 'no-store'}},
    );
}
