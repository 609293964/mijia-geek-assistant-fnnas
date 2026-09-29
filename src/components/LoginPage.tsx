'use client';

import React, {useState, useCallback, useRef} from 'react';
import {Input, Button, message, Typography} from 'antd';
import {LockOutlined, ThunderboltFilled} from '@ant-design/icons';
import ThemeToggle from '@/components/ThemeToggle';

const {Text} = Typography;

interface LoginPageProps {
    onLoginSuccess: () => void;
    reconnecting?: boolean;
}

export default function LoginPage({onLoginSuccess, reconnecting = false}: LoginPageProps) {
    const [passcode, setPasscode] = useState('');
    const [loading, setLoading] = useState(false);
    const isLoggingRef = useRef(false);

    const doLogin = useCallback(async (code: string) => {
        if (code.length !== 6 || isLoggingRef.current) return;
        isLoggingRef.current = true;
        setLoading(true);
        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({passcode: code}),
            });
            const result = await response.json();
            if (result.success) {
                message.success('连接成功');
                onLoginSuccess();
            } else {
                message.error(result.message || '连接失败');
                isLoggingRef.current = false;
            }
        } catch (error) {
            message.error('连接失败: ' + String(error));
            isLoggingRef.current = false;
        } finally {
            setLoading(false);
        }
    }, [onLoginSuccess]);

    const handlePasscodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
        setPasscode(value);
        if (value.length === 6) {
            setTimeout(() => doLogin(value), 0);
        }
    };

    return (
        <div className="login-page">
            <div className="login-top-actions">
                <ThemeToggle/>
            </div>

            {/* 亮色主题主视觉 */}
            <div className="login-main-visual" aria-hidden="true">
                <div className="login-visual-slab">
                    <span/>
                    <span/>
                    <span/>
                </div>
            </div>

            {/* 登录卡片 */}
            <div
                className="glass-panel"
                style={{
                    width: 460, maxWidth: '100%', padding: '36px 32px',
                    borderRadius: 'var(--radius-xl)',
                    textAlign: 'center',
                    position: 'relative', zIndex: 1,
                    boxShadow: 'var(--shadow-lg)',
                    animation: 'fadeInUp 0.6s var(--ease-out)',
                }}
            >
                {/* Logo */}
                <div style={{
                    width: 64, height: 64, margin: '0 auto 24px',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--gradient-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 40px rgba(99,102,241,0.3)',
                }}>
                    <ThunderboltFilled style={{fontSize: 28, color: '#fff'}}/>
                </div>

                <h1 className="gradient-text" style={{
                    fontSize: 25, fontWeight: 800, margin: '0 0 28px',
                    letterSpacing: 0,
                }}>
                    米家自动化极客版 AI Agent
                </h1>

                <div style={{marginBottom: 20}}>
                    <Input
                        prefix={<LockOutlined style={{color: 'var(--text-muted)'}}/>}
                        placeholder="输入 6 位米家动态码"
                        maxLength={6}
                        size="large"
                        value={passcode}
                        onChange={handlePasscodeChange}
                        onPressEnter={() => doLogin(passcode)}
                        disabled={loading}
                        style={{
                            textAlign: 'center',
                            letterSpacing: 6,
                            fontSize: 18,
                            fontWeight: 600,
                        }}
                    />
                    <Text style={{color: reconnecting ? 'var(--warning-text)' : 'var(--text-muted)', fontSize: 11, marginTop: 8, display: 'block'}}>
                        {reconnecting
                            ? 'NAS 正在后台恢复已有网关连接，通常无需再次输入验证码；如恢复失败可输入新验证码。'
                            : '输入 6 位动态码后由 NAS 后台建立长连接，关闭浏览器不会主动断开。'}
                    </Text>
                </div>

                <Button
                    type="primary"
                    size="large"
                    block
                    onClick={() => doLogin(passcode)}
                    loading={loading}
                    disabled={passcode.length !== 6}
                    style={{
                        borderRadius: 'var(--radius-md)',
                        height: 44, fontSize: 15, fontWeight: 600,
                    }}
                >
                    {loading ? '正在连接网关...' : '连接网关'}
                </Button>
            </div>
        </div>
    );
}
