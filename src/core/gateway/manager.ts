/**
 * Core - Gateway 连接管理器
 * 统一管理 Gateway 连接状态
 */

import { GatewayClient } from './client';

export interface GatewayManager {
    gateway: GatewayClient | null;
    isConnected(): boolean;
    getStatus(): GatewayConnectionStatus;
    connect(passcode: string, gatewayUrl?: string): Promise<void>;
    disconnect(): Promise<void>;
    ensureConnected(): void;
}

export interface GatewayConnectionStatus {
    connected: boolean;
    /** A previously authenticated process is trying to restore its WebSocket. */
    reconnecting: boolean;
}

export function createGatewayManager(): GatewayManager {
    let gateway: GatewayClient | null = null;
    let gatewayUrl: string | undefined;
    // Kept in memory only. The six-digit code is never written to disk or logs.
    let passcode: string | null = null;
    let monitorTimer: NodeJS.Timeout | null = null;
    let reconnecting = false;
    let operation: Promise<void> | null = null;
    let nextReconnectAt = 0;
    let reconnectDelayMs = 5000;

    const stopMonitor = () => {
        if (monitorTimer) clearInterval(monitorTimer);
        monitorTimer = null;
    };

    const establish = async (url: string, code: string): Promise<void> => {
        const nextGateway = new GatewayClient();
        try {
            await nextGateway.connect(url);
            await nextGateway.authenticate(code);
            const previous = gateway;
            gateway = nextGateway;
            if (previous && previous !== nextGateway) await previous.close();
        } catch (error) {
            await nextGateway.close().catch(() => undefined);
            throw error;
        }
    };

    const attemptReconnect = async (): Promise<void> => {
        if (!passcode || !gatewayUrl || operation || Date.now() < nextReconnectAt) return;
        reconnecting = true;
        const code = passcode;
        const url = gatewayUrl;
        const task = (async () => {
            try {
                await establish(url, code);
                reconnectDelayMs = 5000;
                nextReconnectAt = 0;
            } catch {
                nextReconnectAt = Date.now() + reconnectDelayMs;
                reconnectDelayMs = Math.min(reconnectDelayMs * 2, 300000);
            } finally {
                reconnecting = false;
            }
        })();
        operation = task;
        await task;
        if (operation === task) operation = null;
    };

    const startMonitor = () => {
        stopMonitor();
        monitorTimer = setInterval(() => {
            if (!gateway?.isConnected()) void attemptReconnect();
        }, 10000);
        monitorTimer.unref?.();
    };

    return {
        get gateway() {
            return gateway;
        },

        isConnected(): boolean {
            return gateway !== null && gateway.isConnected();
        },

        getStatus(): GatewayConnectionStatus {
            const connected = gateway !== null && gateway.isConnected();
            return {
                connected,
                reconnecting: !connected && (reconnecting || passcode !== null),
            };
        },

        async connect(newPasscode: string, gatewayUrlOverride?: string): Promise<void> {
            const url = gatewayUrlOverride || process.env.GATEWAY_URL;
            if (!url) {
                throw new Error('未配置网关地址：请在 fnOS 应用设置中填写网关 IP，或设置 GATEWAY_URL 环境变量');
            }

            stopMonitor();
            const previousPasscode = passcode;
            const previousGatewayUrl = gatewayUrl;
            const previousGateway = gateway;
            gatewayUrl = url;
            const task = establish(url, newPasscode);
            operation = task;
            try {
                await task;
                reconnecting = false;
                nextReconnectAt = 0;
                reconnectDelayMs = 5000;
                // Store only after successful authentication so a bad code does not
                // replace an already working connection's recovery credentials.
                passcode = newPasscode;
                startMonitor();
            } catch (error) {
                passcode = previousPasscode;
                gatewayUrl = previousGatewayUrl;
                if (previousGateway?.isConnected()) startMonitor();
                throw error;
            } finally {
                if (operation === task) operation = null;
            }
        },

        async disconnect(): Promise<void> {
            stopMonitor();
            passcode = null;
            gatewayUrl = undefined;
            reconnecting = false;
            nextReconnectAt = 0;
            if (gateway) {
                try {
                    await gateway.close();
                } catch {
                }
                gateway = null;
            }
        },

        ensureConnected(): void {
            if (!this.isConnected()) {
                throw new Error('网关未连接，请先调用 mijia_auth');
            }
        },
    };
}
