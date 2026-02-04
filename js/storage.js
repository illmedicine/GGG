/**
 * Local Storage Management
 * Handles persistence of settings, connections, and sync history
 */
class Storage {
        /**
         * Get or initialize the media post ID map from localStorage
         * Structure: { [connectionId]: { [tumblrPostId]: uniquePostId } }
         */
        static getMediaPostIdMap() {
            const data = localStorage.getItem(CONFIG.STORAGE_KEYS.MEDIA_POST_IDS || 'mediaPostIds');
            return data ? JSON.parse(data) : {};
        }

        /**
         * Save the media post ID map to localStorage
         */
        static saveMediaPostIdMap(map) {
            localStorage.setItem(CONFIG.STORAGE_KEYS.MEDIA_POST_IDS || 'mediaPostIds', JSON.stringify(map));
        }

        /**
         * Get the unique post ID for a Tumblr post (per connection). If not present, generate and persist it.
         */
        static getOrCreateMediaPostId(connectionId, tumblrPostId) {
            const map = this.getMediaPostIdMap();
            if (!map[connectionId]) map[connectionId] = {};
            if (!map[connectionId][tumblrPostId]) {
                map[connectionId][tumblrPostId] = this.generateId();
                this.saveMediaPostIdMap(map);
            }
            return map[connectionId][tumblrPostId];
        }

        /**
         * Get the unique post ID for a Tumblr post (per connection), or null if not present.
         */
        static getMediaPostId(connectionId, tumblrPostId) {
            const map = this.getMediaPostIdMap();
            return map[connectionId]?.[tumblrPostId] || null;
        }

        /**
         * Assign IDs to all synced posts for all connections (retroactive assignment)
         */
        static ensureAllSyncedPostsHaveIds() {
            const connections = this.getConnections();
            let changed = false;
            const map = this.getMediaPostIdMap();
            for (const conn of connections) {
                if (!map[conn.id]) map[conn.id] = {};
                for (const tumblrPostId of conn.syncedPostIds || []) {
                    if (!map[conn.id][tumblrPostId]) {
                        map[conn.id][tumblrPostId] = this.generateId();
                        changed = true;
                    }
                }
            }
            if (changed) this.saveMediaPostIdMap(map);
        }
    /**
     * Get Tumblr API key
     */
    static getTumblrApiKey() {
        return localStorage.getItem(CONFIG.STORAGE_KEYS.TUMBLR_API_KEY) || '';
    }

    /**
     * Set Tumblr API key
     */
    static setTumblrApiKey(apiKey) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.TUMBLR_API_KEY, apiKey);
    }

    /**
     * Get all connections
     */
    static getConnections() {
        const data = localStorage.getItem(CONFIG.STORAGE_KEYS.CONNECTIONS);
        return data ? JSON.parse(data) : [];
    }

    /**
     * Save connections
     */
    static saveConnections(connections) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.CONNECTIONS, JSON.stringify(connections));
    }

    /**
     * Add new connection
     */
    static addConnection(connection) {
        const connections = this.getConnections();
        connection.id = this.generateId();
        connection.createdAt = Date.now();
        connection.lastSync = null;
        connection.syncedPostIds = [];
        connections.push(connection);
        this.saveConnections(connections);
        return connection;
    }

    /**
     * Update connection
     */
    static updateConnection(id, updates) {
        const connections = this.getConnections();
        const index = connections.findIndex(c => c.id === id);
        if (index !== -1) {
            connections[index] = { ...connections[index], ...updates };
            this.saveConnections(connections);
            return connections[index];
        }
        return null;
    }

    /**
     * Delete connection
     */
    static deleteConnection(id) {
        const connections = this.getConnections();
        const filtered = connections.filter(c => c.id !== id);
        this.saveConnections(filtered);
    }

    /**
     * Get connection by ID
     */
    static getConnection(id) {
        const connections = this.getConnections();
        return connections.find(c => c.id === id);
    }

    /**
     * Get synced post IDs for a connection
     */
    static getSyncedPostIds(connectionId) {
        const connection = this.getConnection(connectionId);
        return connection?.syncedPostIds || [];
    }

    /**
     * Mark posts as synced for a connection
     */
    static markPostsAsSynced(connectionId, postIds) {
        const connections = this.getConnections();
        const index = connections.findIndex(c => c.id === connectionId);
        if (index !== -1) {
            const existing = new Set(connections[index].syncedPostIds || []);
            postIds.forEach(id => existing.add(id.toString()));
            
            // Keep only last 1000 post IDs to prevent storage bloat
            const allIds = Array.from(existing);
            connections[index].syncedPostIds = allIds.slice(-1000);
            connections[index].lastSync = Date.now();
            
            this.saveConnections(connections);
        }
    }

    /**
     * Check if post was already synced
     */
    static isPostSynced(connectionId, postId) {
        const syncedIds = this.getSyncedPostIds(connectionId);
        return syncedIds.includes(postId.toString());
    }

    /**
     * Get settings
     */
    static getSettings() {
        const data = localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS);
        const defaults = {
            autoSyncEnabled: false,
            syncInterval: CONFIG.DEFAULT_SYNC_INTERVAL,
            browserNotifications: false,
            soundNotifications: true
        };
        return data ? { ...defaults, ...JSON.parse(data) } : defaults;
    }

    /**
     * Save settings
     */
    static saveSettings(settings) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    }

    /**
     * Update specific setting
     */
    static updateSetting(key, value) {
        const settings = this.getSettings();
        settings[key] = value;
        this.saveSettings(settings);
    }

    /**
     * Get activity log
     */
    static getActivityLog() {
        const data = localStorage.getItem(CONFIG.STORAGE_KEYS.ACTIVITY_LOG);
        return data ? JSON.parse(data) : [];
    }

    /**
     * Add activity log entry
     */
    static addActivity(activity) {
        const log = this.getActivityLog();
        log.unshift({
            id: this.generateId(),
            timestamp: Date.now(),
            ...activity
        });
        
        // Keep only last 100 activities
        const trimmed = log.slice(0, 100);
        localStorage.setItem(CONFIG.STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify(trimmed));
    }

    /**
     * Clear activity log
     */
    static clearActivityLog() {
        localStorage.setItem(CONFIG.STORAGE_KEYS.ACTIVITY_LOG, '[]');
    }

    /**
     * Get stats
     */
    static getStats() {
        const data = localStorage.getItem(CONFIG.STORAGE_KEYS.STATS);
        const defaults = {
            totalSynced: 0,
            lastSyncTime: null
        };
        return data ? { ...defaults, ...JSON.parse(data) } : defaults;
    }

    /**
     * Update stats
     */
    static updateStats(updates) {
        const stats = this.getStats();
        const updated = { ...stats, ...updates };
        localStorage.setItem(CONFIG.STORAGE_KEYS.STATS, JSON.stringify(updated));
    }

    /**
     * Increment synced count
     */
    static incrementSyncedCount(count = 1) {
        const stats = this.getStats();
        stats.totalSynced = (stats.totalSynced || 0) + count;
        stats.lastSyncTime = Date.now();
        localStorage.setItem(CONFIG.STORAGE_KEYS.STATS, JSON.stringify(stats));
    }

    /**
     * Export all data
     */
    static exportAllData() {
        return {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            apiKey: this.getTumblrApiKey(),
            connections: this.getConnections(),
            settings: this.getSettings(),
            activity: this.getActivityLog(),
            stats: this.getStats()
        };
    }

    /**
     * Import data
     */
    static importData(data) {
        if (!data || !data.version) {
            throw new Error('Invalid import data');
        }

        if (data.apiKey) {
            this.setTumblrApiKey(data.apiKey);
        }
        if (data.connections) {
            this.saveConnections(data.connections);
        }
        if (data.settings) {
            this.saveSettings(data.settings);
        }
        if (data.activity) {
            localStorage.setItem(CONFIG.STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify(data.activity));
        }
        if (data.stats) {
            localStorage.setItem(CONFIG.STORAGE_KEYS.STATS, JSON.stringify(data.stats));
        }

        return true;
    }

    /**
     * Clear all data
     */
    static clearAllData() {
        Object.values(CONFIG.STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
    }

    /**
     * Generate unique ID
     */
    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }
}
