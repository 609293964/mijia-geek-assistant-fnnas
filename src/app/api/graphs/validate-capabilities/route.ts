import {NextRequest, NextResponse} from 'next/server';
import {validateGraphCapabilitiesWithGateway} from '@/core';
import {getGateway, isGatewayConnected} from '@/server/gateway/shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    try {
        if (!isGatewayConnected()) return NextResponse.json({success: false, error: '未连接到网关'}, {status: 400});
        const {graph} = await request.json();
        if (!graph?.id || !Array.isArray(graph.nodes)) return NextResponse.json({success: false, error: 'graph 参数无效'}, {status: 400});
        const report = await validateGraphCapabilitiesWithGateway(
            getGateway()!,
            graph,
            graph.durationRequirements ?? graph.durationRequirement,
        );
        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json({success: false, error: `规则能力校验失败: ${error}`}, {status: 500});
    }
}
