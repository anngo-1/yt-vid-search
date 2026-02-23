/**
 * errors - structured error hierarchy
 */

export class AppError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'AppError';
        this.code = code;
    }
}

export class ApiError extends AppError {
    readonly status: number | undefined;
    readonly provider: string | undefined;

    constructor(message: string, options?: { status?: number; provider?: string }) {
        super(message, 'API_ERROR');
        this.name = 'ApiError';
        this.status = options?.status;
        this.provider = options?.provider;
    }
}

export class TranscriptParseError extends AppError {
    readonly rawData: unknown;

    constructor(message: string, rawData: unknown) {
        super(message, 'TRANSCRIPT_PARSE_ERROR');
        this.name = 'TranscriptParseError';
        this.rawData = rawData;
    }
}

export class TranslationParseError extends AppError {
    readonly rawResponse: string;

    constructor(message: string, rawResponse: string) {
        super(message, 'TRANSLATION_PARSE_ERROR');
        this.name = 'TranslationParseError';
        this.rawResponse = rawResponse;
    }
}

export class TopicsParseError extends AppError {
    constructor(message: string) {
        super(message, 'TOPICS_PARSE_ERROR');
        this.name = 'TopicsParseError';
    }
}
