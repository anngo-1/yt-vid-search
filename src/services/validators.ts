/**
 * validators - runtime type guards for message passing and storage
 */

import type { CenterPosition, Position, Size, LLMProvider } from '@/types';

// --- Message guards ---

interface ApiRequestMessage {
    type: 'API_REQUEST';
    requestId?: string;
    url: string;
    options: RequestInit;
}

interface ApiAbortMessage {
    type: 'API_ABORT';
    requestId: string;
}

interface ApiStreamMessage {
    type: 'API_STREAM';
    url: string;
    options: RequestInit;
}

interface OpenPanelMessage {
    type: 'OPEN_PANEL';
}

export type { ApiRequestMessage, ApiAbortMessage, ApiStreamMessage, OpenPanelMessage };

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isApiRequest(message: unknown): message is ApiRequestMessage {
    return isObject(message) && message.type === 'API_REQUEST' && typeof message.url === 'string';
}

export function isApiAbort(message: unknown): message is ApiAbortMessage {
    return isObject(message) && message.type === 'API_ABORT' && typeof message.requestId === 'string';
}

export function isApiStream(message: unknown): message is ApiStreamMessage {
    return isObject(message) && message.type === 'API_STREAM' && typeof message.url === 'string';
}

export function isOpenPanelMessage(message: unknown): message is OpenPanelMessage {
    return isObject(message) && message.type === 'OPEN_PANEL';
}

// --- Storage guards ---

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
}

export function isCenterPosition(value: unknown): value is CenterPosition {
    return isObject(value) && isFiniteNumber(value.centerX) && isFiniteNumber(value.centerY);
}

export function isOldPosition(value: unknown): value is Position {
    return isObject(value) && isFiniteNumber(value.top) && isFiniteNumber(value.left);
}

export function isCaptionPosition(value: unknown): value is CenterPosition | Position {
    return isCenterPosition(value) || isOldPosition(value);
}

export function isSize(value: unknown): value is Size {
    return isObject(value) && isFiniteNumber(value.width) && isFiniteNumber(value.height);
}

// --- API response guards ---

export interface ApiResponse {
    ok: boolean;
    status?: number;
    statusText?: string;
    body?: string;
    error?: string;
}

export function isApiResponse(value: unknown): value is ApiResponse {
    return isObject(value) && typeof value.ok === 'boolean';
}

const LLM_PROVIDERS: ReadonlySet<string> = new Set(['local', 'openrouter', 'custom']);

export function isLLMProvider(value: unknown): value is LLMProvider {
    return typeof value === 'string' && LLM_PROVIDERS.has(value);
}
