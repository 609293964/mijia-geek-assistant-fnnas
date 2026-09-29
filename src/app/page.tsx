'use client';

import React, {useState, useCallback, useEffect, useRef} from 'react';
import {Layout, Typography, Space, message, Tabs} from 'antd';
import {RobotOutlined, HomeOutlined, ApartmentOutlined, ApiOutlined} from '@ant-design/icons';
import Chat from '@/components/Chat';
import DevicePanel from '@/components/DevicePanel';
import GraphPanel from '@/components/GraphPanel';
import SessionPanel from '@/components/SessionPanel';
import LoginPage from '@/components/LoginPage';
import ThemeToggle from '@/components/ThemeToggle';

const {Header, Sider, Content} = Layout;
const {Text} = Typography;

interface SessionMeta {
    id: string;
    title: string;
    summary: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    isActive: boolean;
}

interface SessionMessage {
    seq: number;
    role: 'user' | 'assistant' | 'compressed';
    content: string;
    timestamp: string;
    thinking?: string;
    toolCalls?: Array<{ tool: string; args?: any; result?: any; success: boolean }>;
}

interface GraphSummary {
    id: string;
    name: string;
    enable: boolean;
    lastUpdateTime?: number;
}

export default function HomePage() {
    const [collapsed, setCollapsed] = useState(false);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [authChecked, setAuthChecked] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [devicesLoading, setDevicesLoading] = useState(false);
    const [devices, setDevices] = useState<any[]>([]);
    const [stats, setStats] = useState({total: 0, online: 0, offline: 0, rooms: 0});

    const [sessions, setSessions] = useState<SessionMeta[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
    const [currentMessages, setCurrentMessages] = useState<SessionMessage[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);

    const [graphs, setGraphs] = useState<GraphSummary[]>([]);
    const [graphsLoading, setGraphsLoading] = useState(false);
    const graphsLoadedRef = useRef(false);

    const loadDevices = useCallback(async () => {
        setDevicesLoading(true);
        try {
            const response = await fetch('/api/devices');
            const result = await response.json();
            if (result.success) {
                setDevices(result.devices || []);
                setStats(result.stats || {total: 0, online: 0, offline: 0, rooms: 0});
            } else {
                message.error(result.message || '加载设备失败');
            }
        } catch (error) {
            message.error('加载设备失败: ' + String(error));
        } finally {
            setDevicesLoading(false);
        }
    }, []);

    const loadSessions = useCallback(async () => {
        setSessionsLoading(true);
        try {
            const response = await fetch('/api/sessions');
            const result = await response.json();
            if (result.success) {
                setSessions(result.sessions || []);
            }
        } catch (error) {
            console.error('加载 Session 列表失败:', error);
        } finally {
            setSessionsLoading(false);
        }
    }, []);

    const loadGraphs = useCallback(async () => {
        setGraphsLoading(true);
        try {
            const response = await fetch('/api/graphs');
            const result = await response.json();
            if (result.success) {
                setGraphs(result.graphs || []);
                graphsLoadedRef.current = true;
            }
        } catch (error) {
            console.error('加载规则列表失败:', error);
        } finally {
            setGraphsLoading(false);
        }
    }, []);

    const handleLoginSuccess = async () => {
        setReconnecting(false);
        setIsLoggedIn(true);
        await Promise.all([loadDevices(), loadSessions()]);
    };

    useEffect(() => {
        let active = true;
        const restoreConnection = async () => {
            try {
                const response = await fetch('/api/auth/status', {cache: 'no-store'});
                const result = await response.json();
                if (active && result.success && result.connected) {
                    setIsLoggedIn(true);
                    await Promise.all([loadDevices(), loadSessions()]);
                } else if (active && result.success && result.reconnecting) {
                    setReconnecting(true);
                }
            } catch {
                // The login page remains available when the status probe fails.
            } finally {
                if (active) setAuthChecked(true);
            }
        };
        restoreConnection();
        return () => {
            active = false;
        };
    }, [loadDevices, loadSessions]);

    const handleSelectSession = async (sessionId: string) => {
        setActiveSessionId(sessionId);
        try {
            const response = await fetch(`/api/sessions/${sessionId}`);
            const result = await response.json();
            if (result.success) {
                setCurrentMessages(result.messages || []);
            }
        } catch (error) {
            message.error('加载 Session 消息失败');
        }
    };

    const handleDeleteSession = async (sessionId: string) => {
        try {
            const response = await fetch(`/api/sessions/${sessionId}`, {method: 'DELETE'});
            const result = await response.json();
            if (result.success) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                if (activeSessionId === sessionId) {
                    setActiveSessionId(undefined);
                    setCurrentMessages([]);
                }
                message.success('Session 已删除');
            }
        } catch (error) {
            message.error('删除 Session 失败');
        }
    };

    const handleRenameSession = async (sessionId: string, title: string): Promise<boolean> => {
        try {
            const response = await fetch(`/api/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({title}),
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                message.error(result.error || '重命名失败');
                return false;
            }
            setSessions(prev => prev.map(session => session.id === sessionId ? {...session, title} : session));
            message.success('对话已重命名');
            return true;
        } catch (error) {
            message.error('重命名失败: ' + String(error));
            return false;
        }
    };

    const handleNewSession = () => {
        setActiveSessionId(undefined);
        setCurrentMessages([]);
    };

    const handleSessionCreated = (sessionId: string, messages: SessionMessage[]) => {
        setActiveSessionId(sessionId);
        setCurrentMessages(messages);
        loadSessions();
    };

    const handleForkSession = useCallback(async (sessionId: string, seq: number): Promise<{sessionId: string; messages: SessionMessage[]} | null> => {
        try {
            const response = await fetch(`/api/sessions/${sessionId}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({action: 'fork', seq}),
            });
            const result = await response.json();
            if (result.success && result.session?.id) {
                const branchMessages = result.messages || [];
                setActiveSessionId(result.session.id);
                setCurrentMessages(branchMessages);
                setSessions(prev => [result.session, ...prev.filter(session => session.id !== result.session.id)]);
                message.success('已创建对话分支，原对话保持不变');
                return {sessionId: result.session.id, messages: branchMessages};
            } else {
                message.error(result.error || '创建分支失败');
                return null;
            }
        } catch (error) {
            message.error('创建分支失败: ' + String(error));
            return null;
        }
    }, []);

    const handleToggleGraph = async (id: string, enable: boolean) => {
        try {
            const response = await fetch('/api/graphs', {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id, enable}),
            });
            const result = await response.json();
            if (result.success) {
                setGraphs(prev => prev.map(g => g.id === id ? {...g, enable} : g));
                message.success(enable ? '规则已启用' : '规则已禁用');
            } else {
                message.error(result.message || '操作失败');
            }
        } catch (error) {
            message.error('切换规则状态失败');
        }
    };

    const handleDeleteGraph = async (id: string) => {
        try {
            const response = await fetch(`/api/graphs?id=${id}`, {method: 'DELETE'});
            const result = await response.json();
            if (result.success) {
                setGraphs(prev => prev.filter(g => g.id !== id));
                message.success('规则已删除');
            } else {
                message.error(result.message || '删除失败');
            }
        } catch (error) {
            message.error('删除规则失败');
        }
    };

    const handleGraphChanged = useCallback(() => {
        graphsLoadedRef.current = true;
        loadGraphs();
    }, [loadGraphs]);

    const handleTabChange = (key: string) => {
        if (key === 'graphs' && !graphsLoadedRef.current) {
            loadGraphs();
        }
    };

    if (!authChecked) {
        return <div style={{padding: 32, textAlign: 'center'}}>正在检查网关连接...</div>;
    }

    if (!isLoggedIn) {
        return <LoginPage onLoginSuccess={handleLoginSuccess} reconnecting={reconnecting}/>;
    }

    return (
        <Layout className="app-shell" style={{background: 'var(--bg-deep)'}}>
            {/* 顶栏 */}
            <Header style={{
                padding: '0 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                position: 'sticky',
                top: 0,
                zIndex: 100,
            }}>
                <Space size={12}>
                    <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--gradient-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: 'var(--shadow-glow)',
                    }}>
                        <RobotOutlined style={{fontSize: 16, color: '#fff'}}/>
                    </div>
                    <span className="gradient-text" style={{fontSize: 17, fontWeight: 700, letterSpacing: 0}}>
            米家自动化极客版 AI Agent
          </span>
                </Space>
                <Space className="app-header-actions" size={12}>
                    <Space className="app-device-status" size={6}>
                        <div style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: '#10b981',
                            boxShadow: '0 0 8px rgba(16,185,129,0.5)',
                        }}/>
                        <Text style={{color: 'var(--text-secondary)', fontSize: 12}}>
                            {stats.online}/{stats.total} 设备在线
                        </Text>
                    </Space>
                    <ThemeToggle/>
                </Space>
            </Header>

            <Layout className="app-body">
                {/* 左侧边栏 */}
                <Sider
                    className="app-sider"
                    width={300}
                    collapsible
                    collapsed={collapsed}
                    onCollapse={setCollapsed}
                    breakpoint="lg"
                    trigger={null}
                    style={{
                        borderRight: '1px solid var(--border-subtle)',
                    }}
                >
                    {!collapsed ? (
                        <Tabs
                            className="sidebar-tabs"
                            defaultActiveKey="devices"
                            onChange={handleTabChange}
                            centered
                            size="small"
                            items={[
                                {
                                    key: 'devices',
                                    label: <span><HomeOutlined style={{marginRight: 4}}/>设备</span>,
                                    children: (
                                        <DevicePanel
                                            devices={devices}
                                            stats={stats}
                                            loading={devicesLoading}
                                            onRefresh={loadDevices}
                                        />
                                    ),
                                },
                                {
                                    key: 'graphs',
                                    label: <span><ApartmentOutlined style={{marginRight: 4}}/>规则</span>,
                                    children: (
                                        <GraphPanel
                                            graphs={graphs}
                                            devices={devices}
                                            loading={graphsLoading}
                                            onRefresh={loadGraphs}
                                            onToggle={handleToggleGraph}
                                            onDelete={handleDeleteGraph}
                                        />
                                    ),
                                },
                            ]}
                        />
                    ) : (
                        <div style={{padding: 16, textAlign: 'center', color: 'var(--text-muted)'}}>
                            <ApiOutlined style={{fontSize: 22}}/>
                        </div>
                    )}
                </Sider>

                {/* 主内容区 */}
                <Content className="app-content" style={{padding: 16, background: 'var(--bg-deep)'}}>
                    <div className="app-main-grid" style={{display: 'flex', gap: 12}}>
                        {/* 聊天区 */}
                        <div
                            className="glass-panel app-chat-panel"
                            style={{
                                flex: 1,
                                borderRadius: 'var(--radius-lg)',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            <Chat
                                sessionId={activeSessionId}
                                initialMessages={currentMessages}
                                onSessionCreated={handleSessionCreated}
                                onForkSession={handleForkSession}
                                onGraphChanged={handleGraphChanged}
                            />
                        </div>

                        {/* Session 面板 */}
                        <div
                            className="glass-panel app-session-panel"
                            style={{
                                width: 300,
                                borderRadius: 'var(--radius-lg)',
                                overflow: 'hidden',
                            }}
                        >
                            <SessionPanel
                                sessions={sessions}
                                activeSessionId={activeSessionId}
                                loading={sessionsLoading}
                                onSelectSession={handleSelectSession}
                                onDeleteSession={handleDeleteSession}
                                onRenameSession={handleRenameSession}
                                onNewSession={handleNewSession}
                                onRefresh={loadSessions}
                            />
                        </div>
                    </div>
                </Content>
            </Layout>
        </Layout>
    );
}
