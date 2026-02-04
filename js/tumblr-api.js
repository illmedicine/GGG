/**
 * Tumblr API Integration
 * Handles fetching posts from Tumblr blogs using the public API
 */
class TumblrAPI {
    constructor() {
        this.apiKey = Storage.getTumblrApiKey();
        this.corsProxyIndex = 0;
    }

    /**
     * Update API key
     */
    setApiKey(apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * Extract blog name from URL or return as-is if already a name
     */
    extractBlogName(input) {
        if (!input) return null;
        
        // Remove whitespace
        input = input.trim();
        
        // Handle full URLs
        const urlPatterns = [
            /tumblr\.com\/([^\/\?]+)/i,           // tumblr.com/username
            /([^\/\.]+)\.tumblr\.com/i,           // username.tumblr.com
            /^https?:\/\/([^\/\.]+)\.tumblr/i,    // http://username.tumblr...
        ];

        for (const pattern of urlPatterns) {
            const match = input.match(pattern);
            if (match && match[1]) {
                return match[1].toLowerCase();
            }
        }

        // If no URL pattern matched, assume it's just the username
        // Remove any @ prefix if present
        return input.replace(/^@/, '').toLowerCase();
    }

    /**
     * Build direct API URL (JSONP style with callback)
     */
    buildApiUrl(endpoint, params = {}) {
        const url = new URL(`${CONFIG.TUMBLR_API_BASE}${endpoint}`);
        
        // Add API key
        url.searchParams.append('api_key', this.apiKey);
        
        // Add additional params
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value);
            }
        }

        return url.toString();
    }

    /**
     * Make API request with multiple CORS proxy fallbacks
     */
    async makeRequest(endpoint, params = {}) {
        if (!this.apiKey) {
            throw new Error('Tumblr API key not configured. Please add your API key in Settings.');
        }

        const baseUrl = this.buildApiUrl(endpoint, params);
        let lastError;
        
        // Check if user has configured a custom CORS proxy
        const customProxy = localStorage.getItem('tumblr2discord_cors_proxy');
        
        // List of CORS proxies to try (ordered by reliability)
        const corsProxies = [];
        
        // Add custom proxy first if configured
        if (customProxy) {
            corsProxies.push({
                name: 'custom',
                build: (url) => `${customProxy}?url=${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            });
        }
        
        // Add fallback proxies
        corsProxies.push(
            {
                name: 'codetabs',
                build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            },
            {
                name: 'allorigins-get',
                build: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
                parse: (text) => {
                    const wrapper = JSON.parse(text);
                    return JSON.parse(wrapper.contents);
                }
            },
            {
                name: 'corsproxy-org',
                build: (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            }
        );

        // Try each CORS proxy
        for (let i = 0; i < corsProxies.length; i++) {
            const proxy = corsProxies[i];
            const proxyUrl = proxy.build(baseUrl);
            console.log(`Trying CORS proxy ${i + 1} (${proxy.name}):`, proxyUrl);
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
                
                const response = await fetch(proxyUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    },
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn(`Proxy ${i + 1} HTTP error:`, response.status, errorText);
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                const text = await response.text();
                let data;
                
                try {
                    data = proxy.parse(text);
                } catch (e) {
                    console.warn(`Proxy ${i + 1} parse error:`, e.message, text.substring(0, 200));
                    throw new Error('Invalid JSON response');
                }
                
                if (data.meta && data.meta.status !== 200) {
                    throw new Error(data.meta.msg || 'Unknown Tumblr API error');
                }

                console.log(`Proxy ${i + 1} (${proxy.name}) succeeded!`);
                return data.response;
            } catch (error) {
                lastError = error;
                console.warn(`CORS proxy ${i + 1} (${proxy.name}) failed:`, error.message);
                // Continue to next proxy
            }
        }

        throw new Error('All CORS proxies failed. Please set up a custom CORS proxy in Settings. See README for instructions.');
    }

    /**
     * Get blog info
     */
    async getBlogInfo(blogName) {
        const cleanName = this.extractBlogName(blogName);
        if (!cleanName) {
            throw new Error('Invalid blog name');
        }

        const response = await this.makeRequest(`/blog/${cleanName}.tumblr.com/info`);
        return response.blog;
    }

    /**
     * Get blog posts
     * @param {string} blogName - Blog name or URL
     * @param {Object} options - Fetch options
     * @param {string} options.type - Post type filter (photo, video, text, etc.)
     * @param {number} options.limit - Number of posts to fetch (max 20)
     * @param {number} options.offset - Offset for pagination
     * @param {number} options.before - Unix timestamp to fetch posts before
     */
    async getPosts(blogName, options = {}) {
        const cleanName = this.extractBlogName(blogName);
        if (!cleanName) {
            throw new Error('Invalid blog name');
        }

        const params = {
            limit: Math.min(options.limit || CONFIG.MAX_POSTS_PER_REQUEST, 20),
            offset: options.offset || 0,
            reblog_info: true,
            notes_info: true
        };

        if (options.type) {
            params.type = options.type;
        }

        if (options.before) {
            params.before = options.before;
        }

        const response = await this.makeRequest(`/blog/${cleanName}.tumblr.com/posts`, params);
        return {
            posts: response.posts || [],
            totalPosts: response.total_posts || 0,
            blog: response.blog
        };
    }

    /**
     * Get posts from the last N days
     */
    async getPostsSince(blogName, days = 30, postTypes = []) {
        const cleanName = this.extractBlogName(blogName);
        if (!cleanName) {
            throw new Error('Invalid blog name');
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000);

        const allPosts = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            // Add delay to respect rate limits
            if (offset > 0) {
                await this.delay(CONFIG.TUMBLR_RATE_LIMIT_MS);
            }

            const { posts, totalPosts } = await this.getPosts(blogName, {
                limit: CONFIG.MAX_POSTS_PER_REQUEST,
                offset
            });

            if (posts.length === 0) {
                hasMore = false;
                break;
            }

            for (const post of posts) {
                // Check if post is within date range
                if (post.timestamp < cutoffTimestamp) {
                    hasMore = false;
                    break;
                }

                // Filter by post type if specified
                if (postTypes.length === 0 || postTypes.includes(post.type)) {
                    allPosts.push(post);
                }
            }

            offset += posts.length;
            
            // Safety limit to prevent infinite loops
            if (offset >= 500) {
                hasMore = false;
            }
        }

        return allPosts;
    }

    /**
     * Get new posts since last sync
     */
    async getNewPosts(blogName, lastSyncTimestamp, postTypes = []) {
        const cleanName = this.extractBlogName(blogName);
        if (!cleanName) {
            throw new Error('Invalid blog name');
        }

        const newPosts = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            if (offset > 0) {
                await this.delay(CONFIG.TUMBLR_RATE_LIMIT_MS);
            }

            const { posts } = await this.getPosts(blogName, {
                limit: CONFIG.MAX_POSTS_PER_REQUEST,
                offset
            });

            if (posts.length === 0) {
                hasMore = false;
                break;
            }

            for (const post of posts) {
                if (post.timestamp <= lastSyncTimestamp) {
                    hasMore = false;
                    break;
                }

                if (postTypes.length === 0 || postTypes.includes(post.type)) {
                    newPosts.push(post);
                }
            }

            offset += posts.length;

            // Safety limit
            if (offset >= 200) {
                hasMore = false;
            }
        }

        return newPosts;
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Format post for display
     */
    formatPostForDisplay(post) {
        return {
            id: post.id,
            type: post.type,
            timestamp: post.timestamp,
            date: new Date(post.timestamp * 1000).toLocaleString(),
            url: post.post_url,
            blogName: post.blog_name,
            title: this.getPostTitle(post),
            summary: this.getPostSummary(post),
            images: this.getPostImages(post),
            video: this.getPostVideo(post),
            noteCount: post.note_count || 0,
            tags: post.tags || [],
            isReblog: !!post.reblogged_from_name
        };
    }

    /**
     * Get post title
     */
    getPostTitle(post) {
        if (post.title) return post.title;
        if (post.summary) return post.summary.substring(0, 100);
        if (post.caption) return this.stripHtml(post.caption).substring(0, 100);
        if (post.body) return this.stripHtml(post.body).substring(0, 100);
        return `${post.type} post`;
    }

    /**
     * Get post summary
     */
    getPostSummary(post) {
        let text = '';
        
        if (post.summary) text = post.summary;
        else if (post.caption) text = this.stripHtml(post.caption);
        else if (post.body) text = this.stripHtml(post.body);
        else if (post.text) text = post.text;
        else if (post.source_title) text = `Source: ${post.source_title}`;

        return text.substring(0, 300) + (text.length > 300 ? '...' : '');
    }

    /**
     * Get post images
     */
    getPostImages(post) {
        const images = [];

        if (post.photos && post.photos.length > 0) {
            for (const photo of post.photos) {
                if (photo.original_size) {
                    images.push(photo.original_size.url);
                } else if (photo.alt_sizes && photo.alt_sizes.length > 0) {
                    images.push(photo.alt_sizes[0].url);
                }
            }
        }

        // Check for inline images in body
        if (post.body) {
            const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
            let match;
            while ((match = imgRegex.exec(post.body)) !== null) {
                if (!images.includes(match[1])) {
                    images.push(match[1]);
                }
            }
        }

        return images;
    }

    /**
     * Get post video
     */
    getPostVideo(post) {
        if (post.video_url) {
            return post.video_url;
        }
        
        if (post.player && post.player.length > 0) {
            // Find the highest quality player
            const bestPlayer = post.player.reduce((best, current) => 
                (current.width > (best?.width || 0)) ? current : best
            , null);
            
            if (bestPlayer && bestPlayer.embed_code) {
                // Extract video URL from embed code
                const srcMatch = bestPlayer.embed_code.match(/src=["']([^"']+)["']/i);
                if (srcMatch) return srcMatch[1];
            }
        }

        return null;
    }

    /**
     * Strip HTML tags
     */
    stripHtml(html) {
        if (!html) return '';
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
}

// Export singleton instance
const tumblrAPI = new TumblrAPI();
