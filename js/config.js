/**
 * Configuration Constants
 */
const CONFIG = {
    // Tumblr API base URL (using CORS proxy for client-side requests)
    TUMBLR_API_BASE: 'https://api.tumblr.com/v2',
    
    // CORS Proxy options for client-side requests
    // Note: In production, you may want to use your own proxy or a different service
    CORS_PROXIES: [
        'https://corsproxy.io/?',
        'https://api.allorigins.win/raw?url=',
    ],
    
    // Default settings
    DEFAULT_SYNC_INTERVAL: 15, // minutes
    DEFAULT_HISTORY_DAYS: 30,
    MAX_POSTS_PER_REQUEST: 20,
    
    // Rate limiting
    DISCORD_RATE_LIMIT_MS: 1000, // 1 second between Discord posts
    TUMBLR_RATE_LIMIT_MS: 500,   // 0.5 seconds between Tumblr requests
    
    // Local Storage Keys
    STORAGE_KEYS: {
        TUMBLR_API_KEY: 'tumblr2discord_api_key',
        CONNECTIONS: 'tumblr2discord_connections',
        SYNCED_POSTS: 'tumblr2discord_synced_posts',
        SETTINGS: 'tumblr2discord_settings',
        ACTIVITY_LOG: 'tumblr2discord_activity',
        STATS: 'tumblr2discord_stats',
        MEDIA_POST_IDS: 'tumblr2discord_media_post_ids'
    },
    
    // Post type icons for Discord embeds
    POST_TYPE_ICONS: {
        photo: '📷',
        video: '🎬',
        text: '📝',
        quote: '💬',
        link: '🔗',
        audio: '🎵',
        chat: '💭',
        answer: '❓'
    },
    
    // Post type colors for Discord embeds
    POST_TYPE_COLORS: {
        photo: 0x529ecc,   // Tumblr blue
        video: 0xe74c3c,   // Red
        text: 0x35465c,    // Tumblr dark
        quote: 0x9b59b6,   // Purple
        link: 0x3498db,    // Blue
        audio: 0xe91e63,   // Pink
        chat: 0x2ecc71,    // Green
        answer: 0xf39c12   // Orange
    }
};

// Freeze config to prevent modifications
Object.freeze(CONFIG);
Object.freeze(CONFIG.STORAGE_KEYS);
Object.freeze(CONFIG.POST_TYPE_ICONS);
Object.freeze(CONFIG.POST_TYPE_COLORS);
