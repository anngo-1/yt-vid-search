/**
 * types - shared type definitions
 */

// --- API types ---

export type LLMProvider = 'local' | 'openrouter' | 'custom';

export interface Settings {
    provider?: LLMProvider; // Legacy/Default
    temperature?: number;

    // Per-feature settings
    chat_provider?: LLMProvider;
    chat_model?: string;

    topics_provider?: LLMProvider;
    topics_model?: string;

    captions_provider?: LLMProvider;
    captions_model?: string;

    // OpenRouter settings
    openrouter_api_key?: string;
    openrouter_model?: string; // Default OR model
    // Local LLM settings (LM Studio, etc.)
    local_port?: number;
    local_model?: string; // Default local model
    // Custom endpoint settings
    custom_endpoint?: string;
    custom_api_key?: string;
    custom_model?: string; // Default custom model
    // Chat settings
    fast_followups?: boolean; // Only send transcript on first message
    // Topics settings
    auto_generate_topics?: boolean; // Automatically generate topics when panel opens

    // Translation settings
    translation_lookahead_buffer?: number;
    translation_refill_threshold?: number;
    translation_max_concurrent?: number;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// --- Transcript types ---

export interface TranscriptSegment {
    time: string;
    seconds: number;
    text: string;
}

// --- Topics types ---

export interface TopicSubtopic {
    title: string;
    timestamp: string;
}

export interface Topic {
    title: string;
    timestamp: string;
    subtopics?: TopicSubtopic[];
}

export interface TopicsData {
    topics: Topic[];
}

// --- Comments types ---

export interface Comment {
    author: string;
    authorThumbnail: string;
    text: string;
    likes: string;
    timestamp: string;
    isReply?: boolean;
    replyCount?: number;
    /** Index into the live ytd-comment-thread-renderer NodeList for reply expansion */
    threadIndex?: number;
}

// --- UI types ---

export interface Position {
    top: number;
    left: number;
}

/** Center-based position for stable caption positioning */
export interface CenterPosition {
    centerX: number;
    centerY: number;
}

export interface Size {
    width: number;
    height: number;
}

// --- App state ---

export interface AppState {
    // core
    currentVideoId: string | null;
    transcript: TranscriptSegment[];
    fullTranscriptText: string;
    settings: Settings;

    // panel
    panelOpen: boolean;
    panelCreating: boolean;
    buttonVideoId: string | null;
    isOurFetch: boolean;

    // chat
    chatHistory: ChatMessage[];
    isChatCleared: boolean;

    // topics
    topicsData: TopicsData | null;
    topicsVideoId: string | null;

    // transcript sync
    autoSync: boolean;
    transcriptOffset: number;
    lastActiveSegmentIndex: number | undefined;

    // captions
    captionsEnabled: boolean;
    captionPosition: CenterPosition | Position | null; // CenterPosition preferred, Position for migration
    captionSize: Size | null;
    captionFontSize: number;
    captionBackgroundEnabled: boolean;

    // translation
    translationEnabled: boolean;
    targetLanguage: string;
    translatedSegments: Record<number, string>;
    pendingTranslations: Set<number>;

    // comments
    comments: Comment[];
    commentsLoading: boolean;
    commentsError: string | null;
}

export function createInitialState(): AppState {
    return {
        // core
        currentVideoId: null,
        transcript: [],
        fullTranscriptText: '',
        settings: {},

        // panel
        panelOpen: false,
        panelCreating: false,
        buttonVideoId: null,
        isOurFetch: false,

        // chat
        chatHistory: [],
        isChatCleared: false,

        // topics
        topicsData: null,
        topicsVideoId: null,

        // transcript sync
        autoSync: true,
        transcriptOffset: 0,
        lastActiveSegmentIndex: undefined,

        // captions
        captionsEnabled: false,
        captionPosition: null,
        captionSize: null,
        captionFontSize: 48,
        captionBackgroundEnabled: true,

        // translation
        translationEnabled: false,
        targetLanguage: 'English',
        translatedSegments: {},
        pendingTranslations: new Set(),

        // comments
        comments: [],
        commentsLoading: false,
        commentsError: null,
    };
}
