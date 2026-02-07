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
        
        // Check which proxy worked last time
        const lastWorkingProxy = localStorage.getItem('tumblr2discord_last_proxy');
        
        // List of CORS proxies to try (ordered by reliability)
        let corsProxies = [];
        
        // Add custom proxy first if configured
        if (customProxy) {
            corsProxies.push({
                name: 'custom',
                build: (url) => `${customProxy}?url=${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            });
        }
        
        // Define available proxies (ordered by reliability - codetabs first as it's most reliable)
        const availableProxies = [
            {
                name: 'codetabs',
                build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            },
            {
                name: 'corsproxy-org',
                build: (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            },
            {
                name: 'allorigins-get',
                build: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
                parse: (text) => {
                    const wrapper = JSON.parse(text);
                    return JSON.parse(wrapper.contents);
                }
            }
        ];
        
        // Put last working proxy first
        if (lastWorkingProxy) {
            const lastIndex = availableProxies.findIndex(p => p.name === lastWorkingProxy);
            if (lastIndex > 0) {
                const [lastProxy] = availableProxies.splice(lastIndex, 1);
                availableProxies.unshift(lastProxy);
            }
        }
        
        corsProxies.push(...availableProxies);

        // Add user-configured fallback proxies from CONFIG if present
        if (Array.isArray(CONFIG.CORS_PROXIES) && CONFIG.CORS_PROXIES.length > 0) {
            CONFIG.CORS_PROXIES.forEach((p, idx) => {
                corsProxies.push({
                    name: `config_proxy_${idx + 1}`,
                    build: (url) => `${p}${encodeURIComponent(url)}`,
                    parse: (text) => JSON.parse(text)
                });
            });
        }

        // Try each CORS proxy
        for (let i = 0; i < corsProxies.length; i++) {
            const proxy = corsProxies[i];
            const proxyUrl = proxy.build(baseUrl);
            console.log(`Trying CORS proxy ${i + 1} (${proxy.name}) -> ${proxyUrl}`);
            
            try {
                const response = await fetch(proxyUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });

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
                
                // Remember which proxy worked
                localStorage.setItem('tumblr2discord_last_proxy', proxy.name);
                
                return data.response;
            } catch (error) {
                lastError = error;
                console.warn(`CORS proxy ${i + 1} (${proxy.name}) failed:`, error.message);
                // Continue to next proxy
            }
        }

        throw new Error('All CORS proxies failed. Last error: ' + (lastError?.message || 'unknown') + '. Please set up a custom CORS proxy in Settings. See README for instructions.');
    }

    /**
     * Test CORS proxies by attempting to fetch a lightweight JSON target.
     * Returns array of results: { name, url, ok, status, error, timeMs }
     */
    async testCorsProxies(timeoutMs = 8000) {
        const testTarget = 'https://httpbin.org/get';
        const results = [];

        // Custom proxy first (if configured)
        const customProxy = localStorage.getItem('tumblr2discord_cors_proxy');
        if (customProxy) {
            const proxy = {
                name: 'custom',
                build: (url) => `${customProxy}?url=${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            };
            try {
                const start = Date.now();
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), timeoutMs);
                const response = await fetch(proxy.build(testTarget), { method: 'GET', signal: controller.signal, headers: { 'Accept': 'application/json' } });
                clearTimeout(id);
                const text = await response.text();
                let ok = false;
                try { proxy.parse(text); ok = true; } catch (e) { ok = response.ok; }
                results.push({ name: proxy.name, url: proxy.build(testTarget), ok, status: response.status, timeMs: Date.now() - start });
            } catch (err) {
                results.push({ name: 'custom', url: proxy.build(testTarget), ok: false, error: err.message, timeMs: null });
            }
        }

        // Known dynamic proxies
        const availableProxies = [
            {
                name: 'codetabs',
                build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            },
            {
                name: 'corsproxy-org',
                build: (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
                parse: (text) => JSON.parse(text)
            },
            {
                name: 'allorigins-get',
                build: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
                parse: (text) => { const wrapper = JSON.parse(text); return JSON.parse(wrapper.contents); }
            }
        ];

        const corsProxies = [];
        corsProxies.push(...availableProxies);

        // Add configured proxy list from CONFIG (same format as used elsewhere)
        if (Array.isArray(CONFIG.CORS_PROXIES) && CONFIG.CORS_PROXIES.length > 0) {
            CONFIG.CORS_PROXIES.forEach((p, idx) => {
                corsProxies.push({
                    name: `config_proxy_${idx + 1}`,
                    build: (url) => `${p}${encodeURIComponent(url)}`,
                    parse: (text) => JSON.parse(text)
                });
            });
        }

        // Test each proxy sequentially
        for (const proxy of corsProxies) {
            const start = Date.now();
            const proxyUrl = proxy.build(testTarget);
            try {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), timeoutMs);
                const response = await fetch(proxyUrl, { method: 'GET', signal: controller.signal, headers: { 'Accept': 'application/json' } });
                clearTimeout(id);
                const text = await response.text();
                let ok = false;
                try { proxy.parse(text); ok = true; } catch (e) { ok = response.ok; }
                results.push({ name: proxy.name, url: proxyUrl, ok, status: response.status, timeMs: Date.now() - start });
            } catch (err) {
                results.push({ name: proxy.name, url: proxyUrl, ok: false, error: err.message, timeMs: Date.now() - start });
            }
        }

        return results;
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
            // Note: npf=true changes post format significantly, using legacy format for compatibility
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

        console.log(`Fetching posts from ${cleanName} since ${cutoffDate.toLocaleDateString()} (${days} days ago)`);
        console.log(`Post types filter:`, postTypes.length > 0 ? postTypes : 'ALL');

        const allPosts = [];
        let offset = 0;
        let hasMore = true;
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 2;

        while (hasMore) {
            // Add delay to respect rate limits
            if (offset > 0) {
                await this.delay(1000); // 1 second delay between requests
            }

            try {
                const { posts, totalPosts } = await this.getPosts(blogName, {
                    limit: CONFIG.MAX_POSTS_PER_REQUEST,
                    offset
                });

                console.log(`Fetched ${posts.length} posts (offset: ${offset}, total: ${totalPosts})`);
                consecutiveErrors = 0; // Reset error counter on success

                if (posts.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const post of posts) {
                    console.log(`Post: ${post.type} - ${new Date(post.timestamp * 1000).toLocaleDateString()} - ${post.id}`);
                    
                    // Check if post is within date range
                    if (post.timestamp < cutoffTimestamp) {
                        console.log(`Post too old, stopping fetch`);
                        hasMore = false;
                        break;
                    }

                    // Include all posts if no filter, or filter by post type
                    if (postTypes.length === 0 || postTypes.includes(post.type)) {
                        allPosts.push(post);
                    }
                }

                offset += posts.length;
                
                // Safety limit to prevent infinite loops
                if (offset >= 500) {
                    console.log('Reached 500 post limit');
                    hasMore = false;
                }
            } catch (error) {
                consecutiveErrors++;
                console.error(`Error fetching posts at offset ${offset}:`, error.message);
                
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    console.warn(`Too many consecutive errors, stopping with ${allPosts.length} posts found`);
                    hasMore = false;
                } else {
                    // Wait longer before retry
                    await this.delay(2000);
                }
            }
        }

        console.log(`Found ${allPosts.length} posts within ${days} days`);
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
        const detectedType = this.detectPostType(post);
        const images = this.getPostImages(post);
        const video = this.getPostVideo(post);
        
        // Debug: log reblog posts with no media
        if (images.length === 0 && !video && (post.reblogged_from_name || post.trail?.length > 0)) {
            console.log('Reblog with no media:', {
                id: post.id,
                type: post.type,
                detectedType: detectedType,
                reblogged_from: post.reblogged_from_name,
                post_keys: Object.keys(post)
            });
        }
        
        return {
            id: post.id,
            type: detectedType,
            originalType: post.type,
            timestamp: post.timestamp,
            date: new Date(post.timestamp * 1000).toLocaleString(),
            url: post.post_url,
            blogName: post.blog_name,
            title: this.getPostTitle(post),
            summary: this.getPostSummary(post),
            images: images,
            video: video,
            noteCount: post.note_count || 0,
            tags: post.tags || [],
            isReblog: !!post.reblogged_from_name || (post.trail && post.trail.length > 0)
        };
    }

    /**
     * Detect actual post type based on content (NPF format)
     */
    detectPostType(post) {
        // Check NPF content blocks first
        if (this.hasMediaTypeInContent(post.content, 'video')) return 'video';
        if (this.hasMediaTypeInContent(post.content, 'image')) return 'photo';
        if (this.hasMediaTypeInContent(post.content, 'audio')) return 'audio';

        // Check reblog trail
        if (post.trail && Array.isArray(post.trail)) {
            for (const trail of post.trail) {
                if (this.hasMediaTypeInContent(trail.content, 'video')) return 'video';
                if (this.hasMediaTypeInContent(trail.content, 'image')) return 'photo';
                if (this.hasMediaTypeInContent(trail.content, 'audio')) return 'audio';
                
                // Check trail HTML content
                if (trail.content_raw) {
                    if (this.htmlHasVideo(trail.content_raw)) return 'video';
                    if (this.htmlHasImage(trail.content_raw)) return 'photo';
                }
            }
        }

        // Check reblog object
        if (post.reblog) {
            const reblogHtml = (post.reblog.comment || '') + (post.reblog.tree_html || '');
            if (this.htmlHasVideo(reblogHtml)) return 'video';
            if (this.htmlHasImage(reblogHtml)) return 'photo';
        }

        // Check caption/body HTML
        if (post.caption) {
            if (this.htmlHasVideo(post.caption)) return 'video';
            if (this.htmlHasImage(post.caption)) return 'photo';
        }
        if (post.body) {
            if (this.htmlHasVideo(post.body)) return 'video';
            if (this.htmlHasImage(post.body)) return 'photo';
        }

        // Legacy checks
        if (post.photos && post.photos.length > 0) return 'photo';
        if (post.video_url || post.player) return 'video';
        if (post.audio_url) return 'audio';
        
        // Return original type
        return post.type;
    }

    /**
     * Check if content array has specific media type
     */
    hasMediaTypeInContent(content, mediaType) {
        if (!content || !Array.isArray(content)) return false;
        return content.some(block => block.type === mediaType);
    }

    /**
     * Check if HTML contains video elements
     */
    htmlHasVideo(html) {
        if (!html) return false;
        return /<video|<iframe|<embed/i.test(html);
    }

    /**
     * Check if HTML contains image elements
     */
    htmlHasImage(html) {
        if (!html) return false;
        return /<img[^>]+src=/i.test(html);
    }

    /**
     * Get post title
     */
    getPostTitle(post) {
        if (post.title) return post.title;
        if (post.summary) return post.summary.substring(0, 100);
        if (post.caption) return this.stripHtml(post.caption).substring(0, 100);
        if (post.body) return this.stripHtml(post.body).substring(0, 100);
        
        // Check NPF content for text
        if (post.content && Array.isArray(post.content)) {
            for (const block of post.content) {
                if (block.type === 'text' && block.text) {
                    return block.text.substring(0, 100);
                }
            }
        }
        
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
        
        // Check NPF content for text
        if (!text && post.content && Array.isArray(post.content)) {
            const textBlocks = post.content.filter(b => b.type === 'text' && b.text);
            if (textBlocks.length > 0) {
                text = textBlocks.map(b => b.text).join(' ');
            }
        }

        return text.substring(0, 300) + (text.length > 300 ? '...' : '');
    }

    /**
     * Extract image URL from NPF media block
     */
    extractImageFromMedia(media) {
        if (!media) return null;
        
        if (Array.isArray(media)) {
            // Get the largest image from the array
            const largest = media.reduce((a, b) => 
                (a.width || 0) > (b.width || 0) ? a : b
            , media[0]);
            return largest?.url || null;
        }
        
        return media.url || null;
    }

    /**
     * Extract images from content blocks (NPF format)
     */
    extractImagesFromContent(content, images) {
        if (!content || !Array.isArray(content)) return;
        
        for (const block of content) {
            if (block.type === 'image') {
                const url = this.extractImageFromMedia(block.media);
                if (url && !images.includes(url)) {
                    images.push(url);
                }
            }
            // Some blocks have nested content
            if (block.content) {
                this.extractImagesFromContent(block.content, images);
            }
        }
    }

    /**
     * Get post images - handles legacy, NPF, and reblog formats
     */
    getPostImages(post) {
        const images = [];

        // 1. Legacy format - photos array (direct photo posts)
        if (post.photos && post.photos.length > 0) {
            for (const photo of post.photos) {
                if (photo.original_size?.url) {
                    images.push(photo.original_size.url);
                } else if (photo.alt_sizes?.[0]?.url) {
                    images.push(photo.alt_sizes[0].url);
                }
            }
        }

        // 2. NPF format - main content blocks
        this.extractImagesFromContent(post.content, images);

        // 3. Reblog trail - where reblogged content usually lives
        if (post.trail && Array.isArray(post.trail)) {
            for (const trail of post.trail) {
                // Trail content blocks (NPF)
                this.extractImagesFromContent(trail.content, images);
                
                // Trail might have content_raw with HTML
                if (trail.content_raw) {
                    this.extractImagesFromHtml(trail.content_raw, images);
                }
            }
        }

        // 4. Reblog object - another location for reblogged content
        if (post.reblog) {
            if (post.reblog.comment) {
                this.extractImagesFromHtml(post.reblog.comment, images);
            }
            if (post.reblog.tree_html) {
                this.extractImagesFromHtml(post.reblog.tree_html, images);
            }
        }

        // 5. Caption field (photo posts)
        if (post.caption) {
            this.extractImagesFromHtml(post.caption, images);
        }

        // 6. Body field (text posts, legacy)
        if (post.body) {
            this.extractImagesFromHtml(post.body, images);
        }

        // 7. Photoset layouts sometimes have image data
        if (post.photoset_photos && Array.isArray(post.photoset_photos)) {
            for (const photo of post.photoset_photos) {
                if (photo.url && !images.includes(photo.url)) {
                    images.push(photo.url);
                }
            }
        }

        // 8. Source URL might be an image
        if (post.source_url && /\.(jpg|jpeg|png|gif|webp)/i.test(post.source_url)) {
            if (!images.includes(post.source_url)) {
                images.push(post.source_url);
            }
        }

        return images;
    }

    /**
     * Extract images from HTML content
     */
    extractImagesFromHtml(html, images) {
        if (!html) return;
        
        // Match img tags
        const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
        let match;
        while ((match = imgRegex.exec(html)) !== null) {
            const url = match[1];
            // Filter out tracking pixels and small images
            if (url && !images.includes(url) && !url.includes('pixel') && !url.includes('beacon')) {
                images.push(url);
            }
        }
        
        // Match data-src for lazy loaded images
        const dataSrcRegex = /data-src=["']([^"']+)["']/gi;
        while ((match = dataSrcRegex.exec(html)) !== null) {
            const url = match[1];
            if (url && !images.includes(url)) {
                images.push(url);
            }
        }
        
        // Match figure/picture source elements
        const sourceRegex = /<source[^>]+srcset=["']([^"'\s,]+)/gi;
        while ((match = sourceRegex.exec(html)) !== null) {
            const url = match[1];
            if (url && !images.includes(url)) {
                images.push(url);
            }
        }
    }

    /**
     * Get post video - handles both legacy and NPF formats
     */
    getPostVideo(post) {
        // Legacy format
        if (post.video_url) {
            return post.video_url;
        }
        
        // NPF format - content blocks
        const videoFromContent = this.extractVideoFromContent(post.content);
        if (videoFromContent) return videoFromContent;

        // Check reblog trail for videos
        if (post.trail && Array.isArray(post.trail)) {
            for (const trail of post.trail) {
                const videoFromTrail = this.extractVideoFromContent(trail.content);
                if (videoFromTrail) return videoFromTrail;
                
                // Check trail content_raw for embedded videos
                if (trail.content_raw) {
                    const videoFromHtml = this.extractVideoFromHtml(trail.content_raw);
                    if (videoFromHtml) return videoFromHtml;
                }
            }
        }

        // Check reblog object for videos
        if (post.reblog) {
            if (post.reblog.comment) {
                const videoFromComment = this.extractVideoFromHtml(post.reblog.comment);
                if (videoFromComment) return videoFromComment;
            }
            if (post.reblog.tree_html) {
                const videoFromTree = this.extractVideoFromHtml(post.reblog.tree_html);
                if (videoFromTree) return videoFromTree;
            }
        }
        
        // Legacy player embed
        if (post.player && post.player.length > 0) {
            const bestPlayer = post.player.reduce((best, current) => 
                (current.width > (best?.width || 0)) ? current : best
            , null);
            
            if (bestPlayer && bestPlayer.embed_code) {
                const srcMatch = bestPlayer.embed_code.match(/src=["']([^"']+)["']/i);
                if (srcMatch) return srcMatch[1];
            }
        }

        // Check caption/body for video embeds
        if (post.caption) {
            const videoFromCaption = this.extractVideoFromHtml(post.caption);
            if (videoFromCaption) return videoFromCaption;
        }

        if (post.body) {
            const videoFromBody = this.extractVideoFromHtml(post.body);
            if (videoFromBody) return videoFromBody;
        }

        return null;
    }

    /**
     * Extract video from NPF content blocks
     */
    extractVideoFromContent(content) {
        if (!content || !Array.isArray(content)) return null;
        
        for (const block of content) {
            if (block.type === 'video') {
                if (block.url) return block.url;
                if (block.media?.url) return block.media.url;
                // Some video blocks have embed_url
                if (block.embed_url) return block.embed_url;
                // External video providers
                if (block.provider) {
                    if (block.embed_html) {
                        const srcMatch = block.embed_html.match(/src=["']([^"']+)["']/i);
                        if (srcMatch) return srcMatch[1];
                    }
                }
            }
        }
        return null;
    }

    /**
     * Extract video from HTML content
     */
    extractVideoFromHtml(html) {
        if (!html) return null;
        
        // Match video source tags
        const videoRegex = /<video[^>]*>[\s\S]*?<source[^>]+src=["']([^"']+)["']/gi;
        let match = videoRegex.exec(html);
        if (match) return match[1];
        
        // Match video src directly
        const videoSrcRegex = /<video[^>]+src=["']([^"']+)["']/gi;
        match = videoSrcRegex.exec(html);
        if (match) return match[1];
        
        // Match iframe embeds (YouTube, Vimeo, etc.)
        const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
        match = iframeRegex.exec(html);
        if (match) return match[1];
        
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
