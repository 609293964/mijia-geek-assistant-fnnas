/**
 * Core - 设备类型定义
 */

/** 设备信息 */
export interface Device {
    did: string;
    name: string;
    modelName: string;
    online: boolean;
    roomName: string;
}

export interface MiotValueRange {
    min: number;
    max: number;
    step: number;
}

export interface MiotValueListItem {
    value: string | number | boolean;
    description: string;
}

export interface MiotPropertyCapability {
    siid: number;
    piid: number;
    desc: string;
    dtype: string;
    access: string[];
    unit?: string;
    range?: MiotValueRange;
    list?: MiotValueListItem[];
}

export interface MiotEventArgumentCapability extends MiotPropertyCapability {}

export interface MiotEventCapability {
    siid: number;
    eiid: number;
    desc: string;
    arguments: MiotEventArgumentCapability[];
}

export interface MiotActionCapability {
    siid: number;
    aiid: number;
    desc: string;
    in: MiotPropertyCapability[];
}

/** 设备详情信息 */
export interface DeviceInfo {
    did: string;
    /** 该 did 是否存在于网关设备表。false 时其余字段均为占位空值，不代表设备离线 */
    found: boolean;
    name: string;
    model: string;
    modelName: string;
    online: boolean;
    roomName: string;
    urn: string;
    properties?: MiotPropertyCapability[];
    events?: MiotEventCapability[];
    triggers?: Array<{
        siid: number;
        piid?: number;
        eiid?: number;
        desc: string;
        dtype?: string;
        type: 'prop' | 'event';
        range?: unknown;
        list?: unknown;
        arguments?: Array<{
            piid: number;
            desc: string;
            dtype: string;
            range?: unknown;
            list?: unknown;
        }>;
    }>;
    actions?: Array<{
        siid: number;
        piid?: number;
        aiid?: number;
        desc: string;
        dtype?: string;
        type: 'prop' | 'action';
        range?: unknown;
        list?: unknown;
        in?: MiotPropertyCapability[];
    }>;
    readable?: Array<{
        siid: number;
        piid: number;
        desc: string;
        dtype?: string;
        unit?: string;
        range?: MiotValueRange;
        list?: MiotValueListItem[];
    }>;
    /** MIOT Spec 是否已成功完整读取；unknown/ unavailable 时禁止猜测设备能力。 */
    specStatus?: 'loaded' | 'unavailable';
    specError?: string;
}

/** 设备列表响应 */
export interface DeviceListResponse {
    devList: Record<string, {
        name: string;
        model: string;
        modelName: string;
        online: boolean;
        roomName: string;
        urn: string;
    }>;
}
