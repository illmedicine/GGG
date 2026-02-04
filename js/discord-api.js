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

        const embed = {
            title: `${typeIcon} ${this.truncate(cleanTitle, 250)}`,
            color: typeColor,
            timestamp: new Date(post.timestamp * 1000).toISOString(),
            footer: {
                text: `${formatted.noteCount} notes • ${formatted.type}`,
            }
        };

        // Only add URL if not hiding user info (URL contains username)
        if (!hideUserInfo) {
            embed.url = formatted.url;
        }

        // Add author info only if not hiding
        if (!hideUserInfo && (blogInfo || post.blog_name)) {
            embed.author = {
                name: blogInfo?.title || post.blog_name,
                url: `https://${post.blog_name}.tumblr.com`,
                icon_url: blogInfo?.avatar?.[0]?.url || `https://api.tumblr.com/v2/blog/${post.blog_name}.tumblr.com/avatar/64`
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

        // Add video thumbnail or link
        if (formatted.video) {
            if (!embed.description) {
                embed.description = '';
            }
            embed.description += `\n\n🎬 Video attached`;
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
    async sendPostWithAllImages(webhookUrl, post, blogInfo = null) {
        const formatted = tumblrAPI.formatPostForDisplay(post);
        
        if (formatted.images.length <= 1) {
            // Single image or no images, use regular embed
            return await this.sendPost(webhookUrl, post, blogInfo);
        }

        // For multiple images, send main embed then additional images
        const mainMessage = this.createPostMessage(post, blogInfo);
        await this.queueMessage(webhookUrl, mainMessage);

        // Send additional images (Discord allows up to 10 embeds per message)
        const additionalImages = formatted.images.slice(1, 10);
        if (additionalImages.length > 0) {
            const imageEmbeds = additionalImages.map(url => ({
                url: formatted.url,
                image: { url }
            }));

            const imageMessage = {
                username: `Tumblr • ${post.blog_name}`,
                avatar_url: `https://api.tumblr.com/v2/blog/${post.blog_name}.tumblr.com/avatar/64`,
                embeds: imageEmbeds
            };

            await this.delay(CONFIG.DISCORD_RATE_LIMIT_MS);
            await this.queueMessage(webhookUrl, imageMessage);
        }

        return true;
    }

    /**
     * Send a simple notification message
     */
    async sendNotification(webhookUrl, title, description, color = 0x529ecc) {
        const message = {
            username: 'Tumblr2Discord',
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
