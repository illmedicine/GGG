/**
 * Discord Webhook API Integration
 * Handles posting messages to Discord channels via webhooks
 */
class DiscordAPI {
    constructor() {
        this.rateLimitQueue = [];
        this.isProcessingQueue = false;
    }

    /**
     * Validate webhook URL
     */
    isValidWebhookUrl(url) {
        if (!url) return false;
        const pattern = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;
        return pattern.test(url);
    }

    /**
     * Test webhook connection
     */
    async testWebhook(webhookUrl) {
        if (!this.isValidWebhookUrl(webhookUrl)) {
            throw new Error('Invalid webhook URL format');
        }

        try {
            const response = await fetch(webhookUrl, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`Webhook test failed: HTTP ${response.status}`);
            }

            const data = await response.json();
            return {
                valid: true,
                name: data.name,
                channelId: data.channel_id,
                guildId: data.guild_id
            };
        } catch (error) {
            throw new Error(`Webhook test failed: ${error.message}`);
        }
    }

    /**
     * Send message to Discord webhook
     */
    async sendMessage(webhookUrl, message) {
        if (!this.isValidWebhookUrl(webhookUrl)) {
            throw new Error('Invalid webhook URL');
        }

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(message)
        });

        if (response.status === 429) {
            // Rate limited
            const retryAfter = response.headers.get('Retry-After') || 5;
            throw new Error(`Rate limited. Retry after ${retryAfter} seconds.`);
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Discord API error: ${response.status} - ${errorText}`);
        }

        return true;
    }

    /**
     * Queue message for rate-limited sending
     */
    queueMessage(webhookUrl, message) {
        return new Promise((resolve, reject) => {
            this.rateLimitQueue.push({
                webhookUrl,
                message,
                resolve,
                reject
            });

            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }

    /**
     * Process message queue with rate limiting
     */
    async processQueue() {
        if (this.isProcessingQueue || this.rateLimitQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.rateLimitQueue.length > 0) {
            const item = this.rateLimitQueue.shift();
            
            try {
                await this.sendMessage(item.webhookUrl, item.message);
                item.resolve(true);
            } catch (error) {
                item.reject(error);
            }

            // Wait between messages to avoid rate limits
            if (this.rateLimitQueue.length > 0) {
                await this.delay(CONFIG.DISCORD_RATE_LIMIT_MS);
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Create Discord embed from Tumblr post
     */
    createEmbed(post, blogInfo = null, hideUserInfo = true) {
        const formatted = tumblrAPI.formatPostForDisplay(post);
        const typeIcon = CONFIG.POST_TYPE_ICONS[formatted.type] || '📌';
        const typeColor = CONFIG.POST_TYPE_COLORS[formatted.type] || 0x529ecc;
        // Clean the title to remove usernames
        let cleanTitle = this.sanitizeTitle(formatted.title);
        // Get unique post ID (assign if needed)
        let uniquePostId = null;
        if (post._connectionId && post.id) {
            uniquePostId = Storage.getOrCreateMediaPostId(post._connectionId, post.id);
        }
        const embed = {
            title: `${typeIcon} ${this.truncate(cleanTitle, 250)}`,
            color: typeColor,
            timestamp: new Date(post.timestamp * 1000).toISOString(),
            footer: {
                text: `${uniquePostId ? `ID: ${uniquePostId} • ` : ''}${formatted.noteCount} notes • ${formatted.type}`,
            }
        };
        // Only add URL if not hiding user info and it is NOT a Tumblr post URL
        const isTumblrPost = /tumblr\.com/i.test(formatted.url);
        if (!hideUserInfo && !isTumblrPost) {
            embed.url = formatted.url;
        }

        // Add author info only if not hiding and author URL is not Tumblr (to avoid revealing Tumblr links)
        if (!hideUserInfo && (blogInfo || post.blog_name)) {
            const authorUrl = `https://${post.blog_name}.tumblr.com`;
            const authorIcon = blogInfo?.avatar?.[0]?.url || `https://api.tumblr.com/v2/blog/${post.blog_name}.tumblr.com/avatar/64`;
            embed.author = {
                name: blogInfo?.title || post.blog_name,
                // Only set author URL if it is not a Tumblr link
                url: /tumblr\.com/i.test(authorUrl) ? undefined : authorUrl,
                icon_url: /tumblr\.com/i.test(authorIcon) ? undefined : authorIcon
            };
        }
        // Add description (sanitized if hiding user info)
        if (formatted.summary) {
            let description = formatted.summary;
            if (hideUserInfo) {
                description = this.sanitizeText(description);
            }
            embed.description = this.truncate(description, 2000);
        }
        // Add image
        if (formatted.images && formatted.images.length > 0) {
            embed.image = { url: formatted.images[0] };
        }
        // Add video - post direct URL for Discord to embed if possible
        if (formatted.video) {
            if (!embed.description) {
                embed.description = '';
            }

            // Detect Tumblr-hosted videos and always suppress the raw Tumblr URL
            const isTumblrVideo = /tumblr\.com/i.test(formatted.video);
            if (!isTumblrVideo) {
                // For non-Tumblr videos (YouTube, Vimeo, etc.), include the URL so Discord can embed it
                embed.description += `\n\n🎬 ${formatted.video}`;
            } else {
                // For Tumblr videos, don't include the raw URL. Indicate a video is present (link hidden).
                embed.description += `\n\n🎬 Video (link hidden)`;
            }
        }
        // Add tags as field (only if not hiding user info, tags can be identifying)
        if (!hideUserInfo && formatted.tags && formatted.tags.length > 0) {
            const tagsText = formatted.tags.slice(0, 10).map(t => `#${t}`).join(' ');
            embed.fields = [{
                name: 'Tags',
                value: this.truncate(tagsText, 1024),
                inline: false
            }];
        }

        // Add Media ID prominently if available
        if (uniquePostId) {
            embed.fields = embed.fields || [];
            // Put Media ID first so it's easy to spot
            embed.fields.unshift({
                name: 'Media ID',
                value: uniquePostId.toString(),
                inline: true
            });
        }

        return embed;
    }

    /**
     * Create message payload for Tumblr post
     */
    createPostMessage(post, blogInfo = null, customUsername = null, hideUserInfo = true) {
        const embed = this.createEmbed(post, blogInfo, hideUserInfo);
        
        const message = {
            username: customUsername || 'Media Bot',
            embeds: [embed]
        };

        // Only add avatar if not hiding user info
        if (!hideUserInfo) {
            message.avatar_url = `https://api.tumblr.com/v2/blog/${post.blog_name}.tumblr.com/avatar/64`;
        }

        return message;
    }

    /**
     * Send Tumblr post to Discord
     */
    async sendPost(webhookUrl, post, blogInfo = null, customUsername = null, hideUserInfo = true) {
        const message = this.createPostMessage(post, blogInfo, customUsername, hideUserInfo);
        return await this.queueMessage(webhookUrl, message);
    }

    /**
     * Send multiple posts with images gallery style
     */
    async sendPostWithAllImages(webhookUrl, post, blogInfo = null, hideUserInfo = true) {
        const formatted = tumblrAPI.formatPostForDisplay(post);
        
        if (formatted.images.length <= 1) {
            // Single image or no images, use regular embed
            return await this.sendPost(webhookUrl, post, blogInfo, null, hideUserInfo);
        }

        // For multiple images, send main embed then additional images
        const mainMessage = this.createPostMessage(post, blogInfo, null, hideUserInfo);
        await this.queueMessage(webhookUrl, mainMessage);

        // Send additional images (Discord allows up to 10 embeds per message)
        const additionalImages = formatted.images.slice(1, 10);
        if (additionalImages.length > 0) {
            const imageEmbeds = additionalImages.map(url => ({
                image: { url }
            }));

            const imageMessage = {
                username: 'Media Bot',
                embeds: imageEmbeds
            };

            await this.delay(CONFIG.DISCORD_RATE_LIMIT_MS);
            await this.queueMessage(webhookUrl, imageMessage);
        }

        return true;
    }

    /**
     * Send video post - posts video URL as content for Discord to auto-embed
     */
    async sendVideoPost(webhookUrl, post, blogInfo = null, hideUserInfo = true) {
        const formatted = tumblrAPI.formatPostForDisplay(post);
        
        if (!formatted.video) {
            // No video, use regular post
            return await this.sendPost(webhookUrl, post, blogInfo, null, hideUserInfo);
        }

        // Create embed without the video URL in description
        const embed = this.createEmbed(post, blogInfo, hideUserInfo);
        // Remove the video URL from description since we'll post it separately
        if (embed.description) {
            embed.description = embed.description.replace(/\n\n🎬.*$/, '');
        }

        // Send embed first
        const embedMessage = {
            username: 'Media Bot',
            embeds: [embed]
        };
        await this.queueMessage(webhookUrl, embedMessage);

        // Then send video content
        await this.delay(CONFIG.DISCORD_RATE_LIMIT_MS);
        const isTumblrVideo = /tumblr\.com/i.test(formatted.video);

        // Ensure a numeric media ID exists for this post
        let mediaId = null;
        if (post._connectionId && post.id) {
            mediaId = Storage.getMediaPostId(post._connectionId, post.id?.toString()) || Storage.getOrCreateMediaPostId(post._connectionId, post.id?.toString());
        }

        // Check if the video URL appears to be a direct media file (mp4/webm/mov)
        const isDirectMedia = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(formatted.video || '');

        if (!isTumblrVideo) {
            // Non-Tumblr: post the video URL so Discord can auto-embed
            const videoMessage = {
                username: 'Media Bot',
                content: formatted.video
            };
            await this.queueMessage(webhookUrl, videoMessage);
        } else if (isDirectMedia) {
            // Tumblr-hosted direct media (e.g., mp4) — we can safely post the direct media URL so Discord will embed the playable video,
            // while still hiding the Tumblr post link in the embed itself.
            const videoMessage = {
                username: 'Media Bot',
                content: formatted.video
            };
            await this.queueMessage(webhookUrl, videoMessage);
        } else {
            // Tumblr video but not a direct media file (iframe/player) — do not post the raw URL to avoid revealing post details
            // The embed already indicates a hidden video and includes the Media ID field for reference.
            console.log('Tumblr video is not direct media; suppressing raw URL to preserve privacy.');
        }

        return true;
    }

    /**
     * Send a simple notification message
     */
    async sendNotification(webhookUrl, title, description, color = 0x529ecc) {
        const message = {
            username: 'Media Bot',
            embeds: [{
                title,
                description,
                color,
                timestamp: new Date().toISOString()
            }]
        };

        return await this.sendMessage(webhookUrl, message);
    }

    /**
     * Truncate text to max length
     */
    truncate(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    /**
     * Sanitize title to remove Tumblr usernames and identifying info
     */
    sanitizeTitle(title) {
        if (!title) return 'New Post';
        
        let clean = title;
        
        // Remove common Tumblr username patterns
        // Pattern: username: or @username
        clean = clean.replace(/@[\w-]+/g, '');
        clean = clean.replace(/^[\w-]+:\s*/i, '');
        
        // Remove "reblogged from username" patterns
        clean = clean.replace(/reblogged\s+from\s+[\w-]+/gi, '');
        clean = clean.replace(/via\s+[\w-]+/gi, '');
        clean = clean.replace(/source:\s*[\w-]+/gi, '');
        
        // Remove tumblr URLs
        clean = clean.replace(/https?:\/\/[\w-]+\.tumblr\.com\S*/gi, '');
        clean = clean.replace(/[\w-]+\.tumblr\.com/gi, '');
        
        // Clean up extra whitespace
        clean = clean.replace(/\s+/g, ' ').trim();
        
        // If title is now empty or just punctuation, use generic title
        if (!clean || clean.length < 3 || /^[\s\W]*$/.test(clean)) {
            return 'New Post';
        }
        
        return clean;
    }

    /**
     * Sanitize text/description to remove usernames and identifying info
     */
    sanitizeText(text) {
        if (!text) return '';
        
        let clean = text;
        
        // Remove @mentions
        clean = clean.replace(/@[\w-]+/g, '');
        
        // Remove tumblr URLs
        clean = clean.replace(/https?:\/\/[\w-]+\.tumblr\.com\S*/gi, '[link]');
        clean = clean.replace(/[\w-]+\.tumblr\.com/gi, '');
        
        // Remove "reblogged from" and similar patterns
        clean = clean.replace(/reblogged\s+from\s+[\w-]+/gi, '');
        clean = clean.replace(/via\s+[\w-]+/gi, '');
        clean = clean.replace(/source:\s*[\w-]+/gi, '');
        clean = clean.replace(/posted\s+by\s+[\w-]+/gi, '');
        
        // Clean up extra whitespace
        clean = clean.replace(/\s+/g, ' ').trim();
        
        return clean;
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
const discordAPI = new DiscordAPI();
