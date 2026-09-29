'use client';
/* eslint-disable @next/next/no-img-element -- 本地 Blob 预览不适合经 next/image 优化 */

import React, {useState, useRef, useEffect, useCallback} from 'react';
import {Button, Space, Typography, Spin, message, Tag, Collapse, Tooltip} from 'antd';
import {Prompts, Sender} from '@ant-design/x';
import {LoadingOutlined, ToolOutlined, RobotOutlined, QuestionCircleOutlined, RollbackOutlined, ThunderboltOutlined, CopyOutlined, CheckOutlined, PictureOutlined, CloseOutlined, DownloadOutlined, ArrowDownOutlined, BulbOutlined, SearchOutlined, SafetyCertificateOutlined, ReloadOutlined, EditOutlined, ReadOutlined} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {extractSseData} from '@/lib/sse';
import {chatCompletionError, chatFailure} from '@/lib/chat-diagnostics';
import {exportConversation, isNearChatBottom, toolDisplayStatus} from '@/lib/chat-workspace';

const {Text} = Typography;
interface AgentOutput {
    type: 'thinking' | 'tool_start' | 'tool_result' | 'complete' | 'waiting_input' | 'error';
    content?: string;
    tool?: string;
    toolCallId?: string;
    args?: any;
    result?: any;
    question?: string;
    options?: string[];
    error?: string;
    message?: string;
    durationMs?: number;
}

interface DisplayToolCall {
    toolCallId?: string;
    tool: string;
    args?: any;
    result?: any;
    success: boolean;
    durationMs?: number;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    images?: PendingImage[];
    seq?: number;
    process?: {
        toolCalls: DisplayToolCall[];
        thinking: string;
    };
}

interface PendingImage {
    id: string;
    file: File;
    name: string;
    previewUrl: string;
}

interface SessionMessage {
    seq: number;
    role: 'user' | 'assistant' | 'compressed';
    content: string;
    timestamp: string;
    thinking?: string;
    toolCalls?: DisplayToolCall[];
}

interface ChatProps {
    sessionId?: string;
    initialMessages?: SessionMessage[];
    onSessionCreated?: (sessionId: string, messages: SessionMessage[]) => void;
    onForkSession?: (sessionId: string, seq: number) => Promise<{sessionId: string; messages: SessionMessage[]} | null>;
    onGraphChanged?: () => void;
}

let messageIdCounter = 0;
const graphMutationTools = new Set(['create_graph', 'update_graph', 'delete_graph', 'toggle_graph']);
const acceptedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const maxImageCount = 4;
const maxImageBytes = 8 * 1024 * 1024;
const maxTotalImageBytes = 20 * 1024 * 1024;
const chatApiPath = '/api/chat';
const quickPromptItems = [
    {key: 'devices', icon: <SearchOutlined/>, label: '查看设备', description: '查询设备状态'},
    {key: 'automation', icon: <BulbOutlined/>, label: '设计自动化', description: '先出方案再执行'},
    {key: 'usage', icon: <SafetyCertificateOutlined/>, label: '检查规则引用', description: '查看设备影响'},
];
const quickPromptText: Record<string, string> = {
    devices: '帮我查看设备状态',
    automation: '帮我设计一个自动化规则，先给出方案，不要立即写入',
    usage: '帮我检查设备被哪些自动化规则引用',
};

async function getChatRequestError(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type') || '';
    let detail = '';

    if (contentType.includes('application/json')) {
        const body = await response.json().catch(() => null) as {error?: unknown} | null;
        if (typeof body?.error === 'string' && body.error.trim()) detail = body.error.trim();
    }

    if (detail) return detail;
    if (response.status === 404) {
        return `未找到聊天接口 ${chatApiPath}。请确认当前打开的是本应用地址并按 Ctrl+F5 强制刷新后重试。`;
    }
    return `聊天接口请求失败（HTTP ${response.status}）`;
}

function generateMessageId(): string {
    return `msg_${Date.now()}_${++messageIdCounter}`;
}

function extractTextOptions(content: string): string[] {
    if (!content) return [];
    const lines = content.split('\n');
    const options: string[] = [];
    for (const rawLine of lines) {
        const line = rawLine.trim();
        const match = line.match(/^(?:[-*•\d\.]+\s*)?((?:方案|选项)[1-9一二三四ABC\d]+[:：].+)$/i);
        if (match && match[1]) {
            options.push(match[1].trim());
        }
    }
    return options.length >= 2 ? options : [];
}

export default function Chat({
                                 sessionId,
                                 initialMessages,
                                 onSessionCreated,
                                 onForkSession,
                                 onGraphChanged,
                             }: ChatProps = {}) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [waitingInput, setWaitingInput] = useState<{ question: string; options: string[] } | null>(null);
    const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(sessionId);

    const [streamThinking, setStreamThinking] = useState('');
    const [streamToolCalls, setStreamToolCalls] = useState<DisplayToolCall[]>([]);
    const [streamFinalContent, setStreamFinalContent] = useState('');
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
    const [showJumpToBottom, setShowJumpToBottom] = useState(false);
    const [isForking, setIsForking] = useState(false);

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageUrlsRef = useRef<Set<string>>(new Set());
    const prevSessionIdRef = useRef<string | undefined>(sessionId);
    const initializedRef = useRef(false);
    const shouldFollowStreamRef = useRef(true);

    useEffect(() => {
        if (sessionId !== prevSessionIdRef.current) {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            setStreamThinking('');
            setStreamToolCalls([]);
            setStreamFinalContent('');
            setWaitingInput(null);
            setIsLoading(false);
            setCurrentSessionId(sessionId);
            setPendingImages([]);
            setIsForking(false);
            imageUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
            imageUrlsRef.current.clear();
            prevSessionIdRef.current = sessionId;
            initializedRef.current = false;
        }
    }, [sessionId]);

    useEffect(() => {
        if (initializedRef.current) return;

        if (initialMessages && initialMessages.length > 0) {
            // 过滤掉 compressed 类型消息，不展示给用户
            const visibleMessages = initialMessages.filter(
                (m): m is SessionMessage & { role: 'user' | 'assistant' } => m.role !== 'compressed'
            );
            const convertedMessages: ChatMessage[] = visibleMessages.map(msg => ({
                id: generateMessageId(),
                role: msg.role,
                content: msg.content || '',
                seq: msg.seq,
                process: (msg.toolCalls && msg.toolCalls.length > 0) || msg.thinking ? {
                    toolCalls: (msg.toolCalls || []).map(tc => ({
                        tool: tc.tool || '',
                        args: tc.args,
                        result: tc.result,
                        success: tc.success !== false,
                    })),
                    thinking: msg.thinking || '',
                } : undefined,
            }));
            setMessages(convertedMessages);
            initializedRef.current = true;
        } else if (initialMessages && initialMessages.length === 0 && !isLoading) {
            setMessages([]);
            initializedRef.current = true;
        }
    }, [initialMessages, isLoading]);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const container = messagesContainerRef.current;
        if (!container) return;
        shouldFollowStreamRef.current = true;
        setShowJumpToBottom(false);
        container.scrollTo({top: container.scrollHeight, behavior});
    }, []);

    useEffect(() => {
        if (shouldFollowStreamRef.current) scrollToBottom('auto');
    }, [messages, streamThinking, streamToolCalls, streamFinalContent, waitingInput, scrollToBottom]);

    useEffect(() => {
        const imageUrls = imageUrlsRef.current;
        return () => {
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
            }
            imageUrls.forEach(url => URL.revokeObjectURL(url));
            imageUrls.clear();
        };
    }, []);

    const addImageFiles = useCallback((files: File[]) => {
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        setPendingImages(current => {
            const next = [...current];
            let totalBytes = next.reduce((sum, image) => sum + image.file.size, 0);

            for (const file of imageFiles) {
                if (next.length >= maxImageCount) {
                    message.warning(`一次最多上传 ${maxImageCount} 张图片`);
                    break;
                }
                if (!acceptedImageTypes.has(file.type)) {
                    message.error(`${file.name} 格式不支持，请使用 PNG、JPG、WebP 或 GIF`);
                    continue;
                }
                if (file.size > maxImageBytes) {
                    message.error(`${file.name} 超过 8 MB`);
                    continue;
                }
                if (totalBytes + file.size > maxTotalImageBytes) {
                    message.error('图片总大小不能超过 20 MB');
                    break;
                }

                const previewUrl = URL.createObjectURL(file);
                imageUrlsRef.current.add(previewUrl);
                next.push({
                    id: `image_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    file,
                    name: file.name,
                    previewUrl,
                });
                totalBytes += file.size;
            }

            return next;
        });
    }, []);

    const removePendingImage = useCallback((id: string) => {
        setPendingImages(current => {
            const target = current.find(image => image.id === id);
            if (target) {
                URL.revokeObjectURL(target.previewUrl);
                imageUrlsRef.current.delete(target.previewUrl);
            }
            return current.filter(image => image.id !== id);
        });
    }, []);

    const copyToClipboard = useCallback(async (content: string, messageId: string) => {
        const text = content.trim();
        if (!text) return;

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', 'true');
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '0';
                document.body.appendChild(textarea);
                let copied = false;
                try {
                    textarea.select();
                    copied = document.execCommand('copy');
                } finally {
                    document.body.removeChild(textarea);
                }
                if (!copied) throw new Error('复制命令失败');
            }

            setCopiedMessageId(messageId);
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
            copyTimerRef.current = setTimeout(() => setCopiedMessageId(null), 1400);
        } catch (error) {
            message.error('复制失败，请手动选中文本复制');
        }
    }, []);

    const renderCopyButton = (content: string, messageId: string) => (
        <Tooltip title={copiedMessageId === messageId ? '已复制' : '复制'}>
            <Button
                type="text"
                size="small"
                aria-label="复制消息"
                className="chat-copy-button"
                icon={copiedMessageId === messageId ? <CheckOutlined/> : <CopyOutlined/>}
                onClick={() => copyToClipboard(content, messageId)}
            />
        </Tooltip>
    );

    const sendMessage = useCallback(async (messageText: string, imageAttachments: PendingImage[] = []) => {
        if ((!messageText.trim() && imageAttachments.length === 0) || isLoading) return;

        const displayMessage = messageText.trim() || '请识别图片中的自动化并生成';

        const userMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'user',
            content: displayMessage,
            images: imageAttachments,
        };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setPendingImages([]);
        setIsLoading(true);
        setWaitingInput(null);
        shouldFollowStreamRef.current = true;
        setShowJumpToBottom(false);

        let currentThinking = '';
        const currentToolCalls: DisplayToolCall[] = [];
        let finalContent = '';
        let graphChanged = false;
        let requestId = '';
        let completed = false;
        let waiting = false;
        let receivedDone = false;
        setStreamThinking('');
        setStreamToolCalls([]);
        setStreamFinalContent('');

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const formData = new FormData();
            formData.append('message', displayMessage);
            if (currentSessionId) formData.append('sessionId', currentSessionId);
            imageAttachments.forEach(image => formData.append('images', image.file, image.name));

            const response = await fetch(chatApiPath, {
                method: 'POST',
                body: formData,
                cache: 'no-store',
                signal: abortController.signal,
            });

            requestId = response.headers.get('X-Request-ID') || '';
            if (!response.ok) {
                throw new Error(await getChatRequestError(response));
            }
            if (!response.headers.get('content-type')?.includes('text/event-stream')) {
                throw new Error('[PROTOCOL] 聊天接口返回了非流式响应，请检查服务地址和反向代理配置。');
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('无法读取响应流');

            const decoder = new TextDecoder();
            let sseBuffer = '';
            let streamError = '';

            const handleOutput = (output: AgentOutput) => {
                switch (output.type) {
                    case 'thinking':
                        currentThinking += output.content || '';
                        setStreamThinking(currentThinking);
                        break;
                    case 'tool_start':
                        currentToolCalls.push({
                            toolCallId: output.toolCallId, tool: output.tool || '',
                            args: output.args, success: false,
                        });
                        setStreamToolCalls([...currentToolCalls]);
                        break;
                    case 'tool_result': {
                        const matchedIndex = output.toolCallId
                            ? currentToolCalls.findIndex(tc => tc.toolCallId === output.toolCallId)
                            : currentToolCalls.length - 1;
                        if (matchedIndex >= 0) {
                            currentToolCalls[matchedIndex].success = output.result?.success !== false;
                            currentToolCalls[matchedIndex].result = output.result;
                            currentToolCalls[matchedIndex].durationMs = output.durationMs;
                            if (graphMutationTools.has(currentToolCalls[matchedIndex].tool) && output.result?.success !== false) {
                                graphChanged = true;
                            }
                            setStreamToolCalls([...currentToolCalls]);
                        }
                        break;
                    }
                    case 'complete':
                        completed = true;
                        finalContent = output.message || output.content || '';
                        setStreamFinalContent(finalContent);
                        break;
                    case 'waiting_input': {
                        waiting = true;
                        finalContent = output.question || currentThinking || '等待你的确认。';
                        const opts = Array.isArray(output.options) ? output.options : [];
                        if (opts.length > 0) setWaitingInput({question: output.question || '请选择', options: opts});
                        break;
                    }
                    case 'error': {
                        streamError = output.error || '发生错误';
                        let pendingIndex = -1;
                        for (let i = currentToolCalls.length - 1; i >= 0; i--) {
                            if (currentToolCalls[i].result === undefined) {
                                pendingIndex = i;
                                break;
                            }
                        }
                        if (pendingIndex >= 0) {
                            currentToolCalls[pendingIndex].success = false;
                            currentToolCalls[pendingIndex].result = {success: false, error: streamError};
                            setStreamToolCalls([...currentToolCalls]);
                        }
                        finalContent = `${currentThinking}\n\n执行失败：${streamError}${requestId ? `\n诊断编号：${requestId}` : ''}`;
                        setStreamFinalContent(finalContent);
                        message.error(streamError);
                        break;
                    }
                }
            };

            const processSseData = (dataItems: string[]) => {
                for (const data of dataItems) {
                    if (data === '[DONE]') { receivedDone = true; continue; }
                    if (!data) continue;
                    handleOutput(JSON.parse(data) as AgentOutput);
                }
            };

            while (true) {
                if (abortController.signal.aborted) {
                    reader.cancel();
                    break;
                }
                const {done, value} = await reader.read();
                if (done) break;

                sseBuffer += decoder.decode(value, {stream: true});
                const extracted = extractSseData(sseBuffer);
                sseBuffer = extracted.rest;
                processSseData(extracted.data);
            }

            sseBuffer += decoder.decode();
            const finalEvents = extractSseData(sseBuffer, true);
            processSseData(finalEvents.data);

            if (abortController.signal.aborted) return;
            if (!streamError && !waiting) {
                const failure = chatCompletionError(completed && receivedDone, finalContent);
                if (failure) handleOutput({type: 'error', error: failure});
            }

            if (!currentSessionId) {
                const sessionsResponse = await fetch('/api/sessions');
                const sessionsData = await sessionsResponse.json();
                if (sessionsData.success && sessionsData.sessions.length > 0) {
                    const newSessionId = sessionsData.sessions[0].id;
                    setCurrentSessionId(newSessionId);
                    const assistantSessionMessage: SessionMessage = {
                        seq: 1, role: 'assistant', content: finalContent,
                        timestamp: new Date().toISOString(),
                        thinking: currentThinking || undefined,
                        toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
                    };
                    const userSessionMessage: SessionMessage = {
                        seq: 0, role: 'user', content: displayMessage, timestamp: new Date().toISOString(),
                    };
                    onSessionCreated?.(newSessionId, [userSessionMessage, assistantSessionMessage]);
                }
            }

            const assistantMessage: ChatMessage = {
                id: generateMessageId(),
                role: 'assistant',
                content: finalContent,
                process: currentToolCalls.length > 0 || currentThinking ? {
                    toolCalls: currentToolCalls, thinking: currentThinking,
                } : undefined,
            };
            setMessages(prev => [...prev, assistantMessage]);
            setStreamThinking('');
            setStreamToolCalls([]);
            setStreamFinalContent('');
            if (graphChanged) {
                onGraphChanged?.();
            }

        } catch (error: unknown) {
            if (abortController.signal.aborted) return;
            setInput(messageText);
            setPendingImages(imageAttachments);
            const detail = error instanceof Error && !/fetch|network|terminated/i.test(error.message)
                ? error.message : chatFailure(error);
            const failure = `发送失败：${detail}${requestId ? `\n诊断编号：${requestId}` : '\n未取得服务端诊断编号。'}\n如已有工具执行，请先核对结果再重试。`;
            setMessages(prev => [...prev, {id: generateMessageId(), role: 'assistant', content: `${currentThinking}\n\n${failure}`, process: {thinking: currentThinking, toolCalls: currentToolCalls}}]);
            setStreamThinking('');
            setStreamToolCalls([]);
            setStreamFinalContent('');
            message.error(failure);
        } finally {
            abortControllerRef.current = null;
            setIsLoading(false);
        }
    }, [isLoading, currentSessionId, onSessionCreated, onGraphChanged]);

    const handleSubmit = async (value: string) => {
        if (!value.trim() && pendingImages.length === 0) return;
        if (waitingInput) setWaitingInput(null);
        sendMessage(value, pendingImages);
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);
        setStreamThinking('');
        setStreamToolCalls([]);
        setStreamFinalContent('');
        setWaitingInput(null);
    };

    const handleEditDraft = useCallback(async (targetSeq: number, messageContent: string, images: PendingImage[] = []) => {
        if (!currentSessionId || !onForkSession || isForking) return;
        setIsForking(true);
        try {
            const branch = await onForkSession(currentSessionId, targetSeq);
            if (!branch) return;
            setInput(messageContent);
            setPendingImages(images);
            message.info('已创建独立分支；原对话仍保留，确认后发送新的问题。');
        } finally {
            setIsForking(false);
        }
    }, [currentSessionId, isForking, onForkSession]);

    const handleExport = useCallback(() => {
        if (messages.length === 0) {
            message.info('当前没有可导出的对话');
            return;
        }
        const blob = new Blob([exportConversation(messages)], {type: 'text/markdown;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `mijia-chat-${new Date().toISOString().slice(0, 10)}.md`;
        anchor.click();
        URL.revokeObjectURL(url);
    }, [messages]);

    const renderMarkdown = (content: string) => {
        if (!content) return null;
        return (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        );
    };

    // ─── 助手消息 ───
    const renderAssistantMessage = (msg: ChatMessage) => {
        const toolCalls = msg.process?.toolCalls || [];
        const hasProcess = msg.process && (toolCalls.length > 0 || msg.process.thinking);
        const messageIndex = messages.findIndex(item => item.id === msg.id);
        const sourceUser = messageIndex > 0 && messages[messageIndex - 1]?.role === 'user'
            ? messages[messageIndex - 1]
            : undefined;
        const canEditSource = sourceUser?.seq !== undefined && !isLoading && !isForking;

        return (
            <div key={msg.id} className="msg-enter" style={{marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start'}}>
                {/* 头像 */}
                <div className="chat-avatar" style={{
                    width: 32, height: 32, borderRadius: 'var(--radius-full)',
                    marginTop: 2,
                }}>
                    <ThunderboltOutlined style={{color: 'inherit', fontSize: 14}}/>
                </div>

                <div style={{flex: 1, maxWidth: '82%'}}>
                    {hasProcess && (
                        <Collapse
                            size="small"
                            style={{marginBottom: 8}}
                            items={[{
                                key: '1',
                                label: (
                                    <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6}}>
                                        <span style={{fontSize: 12, color: 'var(--text-muted)'}}>执行过程</span>
                                        {toolCalls.map((tc, i) => {
                                            const status = toolDisplayStatus(tc, false);
                                            return <Tag key={`${msg.id}-tc-${i}`} color={status.color}>{tc.tool} · {status.label}</Tag>;
                                        })}
                                    </div>
                                ),
                                children: (
                                    <div style={{fontSize: 12}}>
                                        {msg.process!.thinking && (
                                            <div style={{marginBottom: 8}}>
                                                <div style={{color: 'var(--text-muted)', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1}}>思考</div>
                                                <div style={{
                                                    padding: 10, borderRadius: 'var(--radius-sm)',
                                                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)',
                                                    whiteSpace: 'pre-wrap', color: 'var(--warning-text)', lineHeight: 1.6,
                                                }}>
                                                    {msg.process!.thinking}
                                                </div>
                                            </div>
                                        )}
                                        {toolCalls.map((tc, i) => (
                                            <div key={`${msg.id}-tool-${i}`} style={{
                                                marginBottom: 6, padding: 10, borderRadius: 'var(--radius-sm)',
                                                background: 'var(--accent-soft)', border: '1px solid var(--accent-border)',
                                            }}>
                                                <Space style={{marginBottom: 4}}>
                                                    <ToolOutlined style={{color: 'var(--accent)'}}/>
                                                    <Text strong style={{fontSize: 12, color: 'var(--text-bright)'}}>{tc.tool}</Text>
                                                    <Tag color={toolDisplayStatus(tc, false).color} style={{fontSize: 10}}>
                                                        {toolDisplayStatus(tc, false).label}
                                                    </Tag>
                                                    {typeof tc.durationMs === 'number' && (
                                                        <Text style={{fontSize: 10, color: 'var(--text-muted)'}}>{tc.durationMs} ms</Text>
                                                    )}
                                                    {tc.result && (
                                                        <Tooltip title={copiedMessageId === `${msg.id}-tool-${i}` ? '已复制' : '复制结果'}>
                                                            <Button
                                                                type="text" size="small" aria-label="复制工具结果"
                                                                icon={copiedMessageId === `${msg.id}-tool-${i}` ? <CheckOutlined/> : <CopyOutlined/>}
                                                                onClick={() => copyToClipboard(
                                                                    typeof tc.result === 'object' ? JSON.stringify(tc.result, null, 2) : String(tc.result),
                                                                    `${msg.id}-tool-${i}`
                                                                )}
                                                            />
                                                        </Tooltip>
                                                    )}
                                                </Space>
                                                {tc.args && Object.keys(tc.args).length > 0 && (
                                                    <div style={{marginTop: 4, color: 'var(--text-muted)'}}>
                                                        <Text style={{fontSize: 11, fontFamily: 'monospace'}}>{JSON.stringify(tc.args)}</Text>
                                                    </div>
                                                )}
                                                {tc.result && (
                                                    <div style={{marginTop: 6, maxHeight: 160, overflow: 'auto'}}>
                                                        <Text style={{fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-secondary)'}}>
                                                            {typeof tc.result === 'object' ? JSON.stringify(tc.result, null, 2) : String(tc.result)}
                                                        </Text>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ),
                            }]}
                        />
                    )}

                    {msg.content && (
                        <div className="chat-bubble chat-bubble-assistant chat-selectable" style={{
                            padding: '14px 18px',
                            borderRadius: '6px var(--radius-lg) var(--radius-lg) var(--radius-lg)',
                            animation: 'fadeInUp 0.3s var(--ease-out)',
                            position: 'relative',
                        }}>
                            <div className="markdown-content">{renderMarkdown(msg.content)}</div>
                            {renderCopyButton(msg.content, msg.id)}
                        </div>
                    )}
                    {msg.content && !isLoading && (
                        <div className="chat-message-actions" aria-label="回答操作">
                            <Button
                                type="text"
                                size="small"
                                icon={<CopyOutlined/>}
                                onClick={() => copyToClipboard(msg.content, `${msg.id}-action-copy`)}
                            >
                                复制
                            </Button>
                            <Button
                                type="text"
                                size="small"
                                icon={<ReloadOutlined/>}
                                disabled={!canEditSource}
                                onClick={() => {
                                    if (sourceUser?.seq !== undefined) {
                                        void handleEditDraft(sourceUser.seq, sourceUser.content, sourceUser.images);
                                    }
                                }}
                            >
                                重新回答
                            </Button>
                            <Button
                                type="text"
                                size="small"
                                icon={<ReadOutlined/>}
                                onClick={() => {
                                    setInput('请继续说明上面的内容，并补充具体步骤。');
                                    message.info('已放入输入框，确认后发送。');
                                }}
                            >
                                继续说明
                            </Button>
                            <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined/>}
                                disabled={!canEditSource}
                                onClick={() => {
                                    if (sourceUser?.seq !== undefined) {
                                        void handleEditDraft(sourceUser.seq, sourceUser.content, sourceUser.images);
                                    }
                                }}
                            >
                                编辑后重发
                            </Button>
                        </div>
                    )}

                    {(() => {
                        const isLatest = messages[messages.length - 1]?.id === msg.id;
                        const textOptions = isLatest && !isLoading && !waitingInput ? extractTextOptions(msg.content) : [];
                        if (textOptions.length === 0) return null;
                        return (
                            <div className="msg-enter" style={{
                                marginTop: 10,
                                padding: 14,
                                background: 'var(--accent-soft)',
                                border: '1px solid var(--accent-border)',
                                borderRadius: 'var(--radius-lg)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                            }}>
                                <Space size={6} style={{marginBottom: 2}}>
                                    <QuestionCircleOutlined style={{color: 'var(--accent)', fontSize: 13}}/>
                                    <Text strong style={{fontSize: 13, color: 'var(--text-bright)'}}>点击快捷执行方案：</Text>
                                </Space>
                                <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                                    {textOptions.map((opt, i) => (
                                        <Button
                                            key={`text-opt-${i}`}
                                            className="chat-suggestion-button"
                                            onClick={() => sendMessage(opt)}
                                            style={{
                                                textAlign: 'left',
                                                height: 'auto',
                                                whiteSpace: 'normal',
                                                padding: '10px 14px',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--accent-border)',
                                                background: 'var(--surface)',
                                                color: 'var(--text-bright)',
                                                fontSize: 13,
                                            }}
                                        >
                                            {opt}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>
        );
    };

    // ─── 流式输出 ───
    const renderStreaming = () => {
        if (!isLoading) return null;
        const toolCalls = streamToolCalls || [];
        const hasContent = streamThinking || toolCalls.length > 0 || streamFinalContent;
        if (!hasContent) {
            return (
                <div className="msg-enter" style={{marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start'}}>
                    <div className="chat-avatar" style={{
                        width: 32, height: 32, borderRadius: 'var(--radius-full)',
                    }}>
                        <ThunderboltOutlined style={{color: 'inherit', fontSize: 14}}/>
                    </div>
                    <div className="chat-bubble chat-bubble-assistant" style={{
                        padding: '14px 18px',
                        borderRadius: '6px var(--radius-lg) var(--radius-lg) var(--radius-lg)',
                    }}>
                        <div className="typing-indicator">
                            <span/><span/><span/>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="msg-enter" style={{marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start'}}>
                <div className="chat-avatar chat-avatar-active" style={{
                    width: 32, height: 32, borderRadius: 'var(--radius-full)',
                }}>
                    <ThunderboltOutlined style={{color: 'inherit', fontSize: 14}}/>
                </div>

                <div style={{flex: 1, maxWidth: '82%'}}>
                    {(streamThinking || toolCalls.length > 0) && (
                        <Collapse
                            size="small"
                            defaultActiveKey={['1']}
                            style={{marginBottom: 8}}
                            items={[{
                                key: '1',
                                label: (
                                    <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6}}>
                                        <Spin indicator={<LoadingOutlined style={{fontSize: 12, color: 'var(--accent)'}} spin/>}/>
                                        <span style={{fontSize: 12, color: 'var(--text-muted)'}}>执行中</span>
                                        {toolCalls.map((tc, i) => {
                                            const status = toolDisplayStatus(tc, true);
                                            return <Tag key={i} color={status.color}>{tc.tool} · {status.label}</Tag>;
                                        })}
                                    </div>
                                ),
                                children: (
                                    <div style={{fontSize: 12}}>
                                        {streamThinking && (
                                            <div style={{marginBottom: 8}}>
                                                <div style={{color: 'var(--text-muted)', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1}}>思考</div>
                                                <div style={{
                                                    padding: 10, borderRadius: 'var(--radius-sm)',
                                                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)',
                                                    whiteSpace: 'pre-wrap', color: 'var(--warning-text)',
                                                }}>
                                                    {streamThinking}
                                                </div>
                                            </div>
                                        )}
                                        {toolCalls.map((tc, i) => (
                                            <div key={i} style={{
                                                marginBottom: 6, padding: 10, borderRadius: 'var(--radius-sm)',
                                                background: 'var(--accent-soft)', border: '1px solid var(--accent-border)',
                                            }}>
                                                <Space style={{marginBottom: 4}}>
                                                    <ToolOutlined style={{color: 'var(--accent)'}}/>
                                                    <Text strong style={{fontSize: 12, color: 'var(--text-bright)'}}>{tc.tool}</Text>
                                                    <Tag color={toolDisplayStatus(tc, true).color}>
                                                        {toolDisplayStatus(tc, true).label}
                                                    </Tag>
                                                    {typeof tc.durationMs === 'number' && (
                                                        <Text style={{fontSize: 10, color: 'var(--text-muted)'}}>{tc.durationMs} ms</Text>
                                                    )}
                                                    {tc.result && (
                                                        <Tooltip title={copiedMessageId === `stream-tool-${i}` ? '已复制' : '复制结果'}>
                                                            <Button
                                                                type="text" size="small" aria-label="复制工具结果"
                                                                icon={copiedMessageId === `stream-tool-${i}` ? <CheckOutlined/> : <CopyOutlined/>}
                                                                onClick={() => copyToClipboard(
                                                                    typeof tc.result === 'object' ? JSON.stringify(tc.result, null, 2) : String(tc.result),
                                                                    `stream-tool-${i}`
                                                                )}
                                                            />
                                                        </Tooltip>
                                                    )}
                                                </Space>
                                                {tc.args && Object.keys(tc.args).length > 0 && (
                                                    <div style={{marginTop: 4, color: 'var(--text-muted)'}}>
                                                        <Text style={{fontSize: 11, fontFamily: 'monospace'}}>{JSON.stringify(tc.args)}</Text>
                                                    </div>
                                                )}
                                                {tc.result && (
                                                    <div style={{marginTop: 6, maxHeight: 160, overflow: 'auto'}}>
                                                        <Text style={{fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-secondary)'}}>
                                                            {typeof tc.result === 'object' ? JSON.stringify(tc.result, null, 2) : String(tc.result)}
                                                        </Text>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ),
                            }]}
                        />
                    )}

                    {streamFinalContent && (
                        <div className="chat-bubble chat-bubble-assistant chat-selectable" style={{
                            padding: '14px 18px',
                            borderRadius: '6px var(--radius-lg) var(--radius-lg) var(--radius-lg)',
                            position: 'relative',
                        }}>
                            <div className="markdown-content">{renderMarkdown(streamFinalContent)}</div>
                            {renderCopyButton(streamFinalContent, 'streaming-final')}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div style={{height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column'}}>
            {/* 顶栏 */}
            <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <Space size={10}>
                    <div className="chat-avatar" style={{
                        width: 28, height: 28, borderRadius: 'var(--radius-full)',
                    }}>
                        <RobotOutlined style={{fontSize: 14, color: 'inherit'}}/>
                    </div>
                    <Text strong style={{color: 'var(--text-bright)', fontSize: 14}}>智者</Text>
                    {isLoading && (
                        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                            <Spin indicator={<LoadingOutlined style={{fontSize: 13, color: 'var(--accent)'}} spin/>}/>
                            <Text style={{fontSize: 12, color: 'var(--text-muted)'}}>思考中...</Text>
                        </div>
                    )}
                </Space>
                <Tooltip title="导出当前对话（不含工具参数和图片文件）">
                    <Button
                        type="text"
                        icon={<DownloadOutlined/>}
                        disabled={messages.length === 0}
                        onClick={handleExport}
                        aria-label="导出当前对话"
                    >
                        导出
                    </Button>
                </Tooltip>
            </div>

            {/* 消息区 */}
            <div
                ref={messagesContainerRef}
                className="chat-messages"
                style={{flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 24px', position: 'relative'}}
                onScroll={event => {
                    const target = event.currentTarget;
                    const nearBottom = isNearChatBottom(target.scrollTop, target.scrollHeight, target.clientHeight);
                    shouldFollowStreamRef.current = nearBottom;
                    setShowJumpToBottom(!nearBottom);
                }}
            >
                {messages.length === 0 && !isLoading && (
                    <div style={{
                        textAlign: 'center', padding: '60px 20px',
                        animation: 'fadeIn 0.6s var(--ease-out)',
                    }}>
                        <div className="chat-empty-icon" style={{
                            width: 72, height: 72, margin: '0 auto 20px',
                            borderRadius: 'var(--radius-full)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <RobotOutlined style={{fontSize: 32, color: 'inherit'}}/>
                        </div>
                        <div style={{fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--text-bright)'}}>
                            你好！我是智者
                        </div>
                        <Text style={{color: 'var(--text-muted)', fontSize: 14, display: 'block', marginBottom: 28}}>
                            米家自动化极客版 AI 助手
                        </Text>
                        <Prompts
                            className="chat-prompts"
                            vertical
                            items={[
                                {key: 'devices', icon: <SearchOutlined/>, label: '查看设备状态', description: '查询当前设备和在线情况'},
                                {key: 'automation', icon: <BulbOutlined/>, label: '设计自动化规则', description: '先生成方案，确认后再写入'},
                                {key: 'usage', icon: <SafetyCertificateOutlined/>, label: '检查设备规则引用', description: '评估更换或删除设备的影响'},
                            ]}
                            onItemClick={({data}) => {
                                const prompts: Record<string, string> = {
                                    devices: '帮我查看设备状态',
                                    automation: '帮我设计一个自动化规则，先给出方案，不要立即写入',
                                    usage: '帮我检查设备被哪些自动化规则引用',
                                };
                                sendMessage(prompts[data.key]);
                            }}
                        />
                    </div>
                )}

                {messages.map((msg, index) => (
                    msg.role === 'user' ? (
                        <div key={msg.id} className="msg-enter" style={{marginBottom: 20, display: 'flex', justifyContent: 'flex-end'}}>
                            <div style={{maxWidth: '82%'}}>
                                <div className="chat-bubble chat-bubble-user chat-selectable" style={{
                                    padding: '14px 18px',
                                    borderRadius: 'var(--radius-lg) var(--radius-lg) 6px var(--radius-lg)',
                                    position: 'relative',
                                }}>
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="chat-message-images">
                                            {msg.images.map(image => (
                                                <img key={image.id} src={image.previewUrl} alt={image.name}/>
                                            ))}
                                        </div>
                                    )}
                                    <div className="chat-message-content" style={{whiteSpace: 'pre-wrap', lineHeight: 1.6}}>{msg.content}</div>
                                    {renderCopyButton(msg.content, msg.id)}
                                </div>
                                {currentSessionId && onForkSession && !isLoading && msg.seq !== undefined && (
                                    <div style={{textAlign: 'right', marginTop: 4}}>
                                        <Button
                                            type="text" size="small"
                                            icon={<RollbackOutlined/>}
                                            onClick={() => void handleEditDraft(msg.seq!, msg.content, msg.images)}
                                            style={{fontSize: 11, color: 'var(--text-muted)', padding: '0 6px'}}
                                        >
                                            编辑并重发
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        renderAssistantMessage(msg)
                    )
                ))}

                {renderStreaming()}

                {/* 选项卡片 */}
                {waitingInput && Array.isArray(waitingInput.options) && waitingInput.options.length > 0 && (
                    <div className="msg-enter" style={{
                        padding: 18,
                        background: 'var(--accent-soft)',
                        border: '1px solid var(--accent-border)',
                        borderRadius: 'var(--radius-lg)',
                        marginBottom: 16,
                    }}>
                        {waitingInput.question && (
                            <div style={{marginBottom: 14}}>
                                <Space style={{marginBottom: 8}}>
                                    <QuestionCircleOutlined style={{color: 'var(--accent)'}}/>
                                    <Text strong style={{fontSize: 14, color: 'var(--text-bright)'}}>需要你的选择</Text>
                                </Space>
                                <div className="markdown-content">{renderMarkdown(waitingInput.question)}</div>
                            </div>
                        )}
                        <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                            {waitingInput.options.map((opt, i) => (
                                <Button
                                    className="chat-suggestion-button"
                                    key={`option-${i}`}
                                    onClick={() => {
                                        setWaitingInput(null);
                                        sendMessage(opt);
                                    }}
                                    style={{
                                        textAlign: 'left', height: 'auto', whiteSpace: 'normal', padding: '10px 14px',
                                        borderRadius: 'var(--radius-md)',
                                    }}
                                >
                                    {opt}
                                </Button>
                            ))}
                        </div>
                        <Text style={{fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 10}}>
                            也可直接输入自定义回复
                        </Text>
                    </div>
                )}
                {showJumpToBottom && (
                    <Button
                        className="chat-jump-bottom"
                        shape="round"
                        icon={<ArrowDownOutlined/>}
                        onClick={() => scrollToBottom()}
                    >
                        回到底部
                    </Button>
                )}
            </div>

            {/* 输入区 */}
            <div className="chat-input-bar" style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--border-subtle)',
            }} onDragOver={event => event.preventDefault()} onDrop={event => {
                event.preventDefault();
                if (!isLoading) addImageFiles(Array.from(event.dataTransfer.files));
            }}>
                {pendingImages.length > 0 && (
                    <div className="chat-image-preview-list">
                        {pendingImages.map(image => (
                            <div className="chat-image-preview" key={image.id}>
                                <img src={image.previewUrl} alt={image.name}/>
                                <Tooltip title={image.name}>
                                    <span>{image.name}</span>
                                </Tooltip>
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label={`移除 ${image.name}`}
                                    icon={<CloseOutlined/>}
                                    onClick={() => removePendingImage(image.id)}
                                />
                            </div>
                        ))}
                    </div>
                )}
                {!isLoading && (
                    <Prompts
                        className="chat-input-prompts"
                        items={quickPromptItems}
                        wrap
                        onItemClick={({data}) => sendMessage(quickPromptText[data.key] || '')}
                    />
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    hidden
                    onChange={event => {
                        addImageFiles(Array.from(event.target.files || []));
                        event.target.value = '';
                    }}
                />
                <Sender
                    rootClassName="chat-sender"
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                    onCancel={handleStop}
                    loading={isLoading}
                    readOnly={isLoading}
                    submitType="enter"
                    autoSize={{minRows: 1, maxRows: 5}}
                    actions={(_, {components: {SendButton, LoadingButton}}) => isLoading
                        ? <LoadingButton/>
                        : <SendButton disabled={!input.trim() && pendingImages.length === 0}/>
                    }
                    placeholder={waitingInput ? '选择上方选项，或输入自定义回复...' : '输入消息，Enter 发送，Shift+Enter 换行'}
                    onPaste={event => {
                        const files = Array.from(event.clipboardData.files);
                        if (files.some(file => file.type.startsWith('image/'))) {
                            event.preventDefault();
                            addImageFiles(files);
                        }
                    }}
                    prefix={(
                        <Tooltip title="上传自动化截图（也可粘贴或拖入）">
                            <Button
                                type="text"
                                className="chat-image-button"
                                icon={<PictureOutlined/>}
                                disabled={isLoading}
                                aria-label="上传图片"
                                onClick={() => fileInputRef.current?.click()}
                            />
                        </Tooltip>
                    )}
                />
                <Text className="chat-safety-hint">
                    涉及创建、更新、启停或删除规则时，发送前请核对目标；失败后不要盲目重试。
                </Text>
            </div>
        </div>
    );
}
