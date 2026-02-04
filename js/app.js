/**
 * Main Application Logic
 * Handles UI interactions, navigation, and coordination between components
 */
class App {
    constructor() {
        this.currentPage = 'dashboard';
        this.autoSyncInterval = null;
        this.historyPosts = [];
        this.selectedHistoryPosts = new Set();
        
        this.init();
    }

    /**
     * Initialize the application
     */
    async init() {
        // Setup navigation
        this.setupNavigation();
        
        // Setup modal handlers
        this.setupModal();
        
        // Setup dashboard
        this.setupDashboard();
        
        // Setup connections page
        this.setupConnectionsPage();
        
        // Setup history page
        this.setupHistoryPage();
        
        // Setup settings page
        this.setupSettingsPage();
        
        // Load initial data
        this.loadSettings();
        this.updateDashboard();
        this.renderConnections();
        
        // Setup auto-sync
        this.setupAutoSync();
        
        // Request notification permission
        this.requestNotificationPermission();
        
        console.log('Tumblr2Discord app initialized');
    }

    /**
     * Setup navigation between pages
     */
    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                this.navigateTo(page);
            });
        });
    }

    /**
     * Navigate to a page
     */
    navigateTo(page) {
        // Update nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        
        // Update pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === page);
        });
        
        this.currentPage = page;
        
        // Page-specific refresh
        if (page === 'dashboard') {
            this.updateDashboard();
        } else if (page === 'connections') {
            this.renderConnections();
        }
    }

    /**
     * Setup modal handlers
     */
    setupModal() {
        const modal = document.getElementById('connectionModal');
        const closeBtn = document.getElementById('closeModal');
        const cancelBtn = document.getElementById('cancelConnection');
        const form = document.getElementById('connectionForm');

        closeBtn.addEventListener('click', () => this.closeModal());
        cancelBtn.addEventListener('click', () => this.closeModal());
        
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeModal();
        });

        // Form submission
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveConnection();
        });
    }

    /**
     * Open connection modal
     */
    openModal(connection = null) {
        const modal = document.getElementById('connectionModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('connectionForm');
        
        // Reset form
        form.reset();
        
        if (connection) {
            title.textContent = 'Edit Connection';
            document.getElementById('connectionId').value = connection.id;
            document.getElementById('tumblrBlog').value = connection.tumblrBlog;
            document.getElementById('connectionName').value = connection.name || '';
            document.getElementById('discordWebhook').value = connection.webhookUrl;
            document.getElementById('connectionEnabled').checked = connection.enabled !== false;
            
            // Set post types
            const postTypeCheckboxes = document.querySelectorAll('input[name="postTypes"]');
            postTypeCheckboxes.forEach(cb => {
                cb.checked = connection.postTypes?.includes(cb.value) || false;
            });
        } else {
            title.textContent = 'Add New Connection';
            document.getElementById('connectionId').value = '';
            
            // Default post types
            document.querySelectorAll('input[name="postTypes"]').forEach(cb => {
                cb.checked = ['photo', 'video', 'text'].includes(cb.value);
            });
        }
        
        modal.classList.add('active');
    }

    /**
     * Close connection modal
     */
    closeModal() {
        document.getElementById('connectionModal').classList.remove('active');
    }

    /**
     * Save connection from form
     */
    async saveConnection() {
        const id = document.getElementById('connectionId').value;
        const tumblrBlog = document.getElementById('tumblrBlog').value.trim();
        const name = document.getElementById('connectionName').value.trim();
        const webhookUrl = document.getElementById('discordWebhook').value.trim();
        const enabled = document.getElementById('connectionEnabled').checked;
        
        // Get selected post types
        const postTypes = Array.from(document.querySelectorAll('input[name="postTypes"]:checked'))
            .map(cb => cb.value);

        // Validation
        if (!tumblrBlog) {
            this.showToast('Please enter a Tumblr blog URL or username', 'error');
            return;
        }

        if (!webhookUrl) {
            this.showToast('Please enter a Discord webhook URL', 'error');
            return;
        }

        if (!discordAPI.isValidWebhookUrl(webhookUrl)) {
            this.showToast('Invalid Discord webhook URL format', 'error');
            return;
        }

        this.showLoading('Validating connection...');

        try {
            // Validate Tumblr blog
            const blogName = tumblrAPI.extractBlogName(tumblrBlog);
            let blogInfo;
            
            try {
                blogInfo = await tumblrAPI.getBlogInfo(blogName);
            } catch (error) {
                this.hideLoading();
                this.showToast(`Could not find Tumblr blog: ${error.message}`, 'error');
                return;
            }

            // Validate Discord webhook
            try {
                await discordAPI.testWebhook(webhookUrl);
            } catch (error) {
                this.hideLoading();
                this.showToast(`Discord webhook error: ${error.message}`, 'error');
                return;
            }

            const connectionData = {
                tumblrBlog: blogName,
                tumblrBlogTitle: blogInfo.title || blogName,
                name: name || blogInfo.title || blogName,
                webhookUrl,
                postTypes,
                enabled
            };

            if (id) {
                // Update existing
                Storage.updateConnection(id, connectionData);
                this.showToast('Connection updated successfully', 'success');
            } else {
                // Add new
                Storage.addConnection(connectionData);
                this.showToast('Connection added successfully', 'success');
                
                Storage.addActivity({
                    type: 'connection_added',
                    text: `Added connection for ${blogName}`,
                    icon: 'success'
                });
            }

            this.closeModal();
            this.renderConnections();
            this.updateDashboard();
        } catch (error) {
            this.showToast(`Error saving connection: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Setup dashboard page
     */
    setupDashboard() {
        document.getElementById('syncAllBtn').addEventListener('click', () => this.syncAll());
        document.getElementById('addConnectionBtn').addEventListener('click', () => {
            this.openModal();
            this.navigateTo('connections');
        });
        document.getElementById('syncHistoryBtn').addEventListener('click', () => {
            this.navigateTo('history');
        });
        document.getElementById('exportConfigBtn').addEventListener('click', () => this.exportData());
    }

    /**
     * Update dashboard statistics and activity
     */
    updateDashboard() {
        const connections = Storage.getConnections();
        const stats = Storage.getStats();
        const activity = Storage.getActivityLog();

        // Update stats
        document.getElementById('totalBlogs').textContent = connections.length;
        document.getElementById('totalWebhooks').textContent = 
            new Set(connections.map(c => c.webhookUrl)).size;
        document.getElementById('totalSynced').textContent = stats.totalSynced || 0;
        document.getElementById('lastSync').textContent = stats.lastSyncTime 
            ? this.formatTimeAgo(stats.lastSyncTime) 
            : 'Never';

        // Update activity list
        this.renderActivityList(activity);

        // Update blog filter in history
        this.updateHistoryBlogFilter();
    }

    /**
     * Render activity list
     */
    renderActivityList(activities) {
        const container = document.getElementById('activityList');
        
        if (!activities || activities.length === 0) {
            container.innerHTML = '<p class="empty-state">No recent activity</p>';
            return;
        }

        container.innerHTML = activities.slice(0, 10).map(activity => {
            const iconClass = activity.icon || 'info';
            const icon = iconClass === 'success' ? 'check' : 
                        iconClass === 'error' ? 'times' : 'info';
            
            return `
                <div class="activity-item">
                    <div class="activity-icon ${iconClass}">
                        <i class="fas fa-${icon}"></i>
                    </div>
                    <div class="activity-content">
                        <div class="activity-text">${activity.text}</div>
                        <div class="activity-time">${this.formatTimeAgo(activity.timestamp)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Setup connections page
     */
    setupConnectionsPage() {
        document.getElementById('newConnectionBtn').addEventListener('click', () => {
            this.openModal();
        });
    }

    /**
     * Render connections list
     */
    renderConnections() {
        const connections = Storage.getConnections();
        const container = document.getElementById('connectionsList');

        if (connections.length === 0) {
            container.innerHTML = '<p class="empty-state">No connections configured. Add your first connection!</p>';
            return;
        }

        container.innerHTML = connections.map(conn => {
            const statusBadge = conn.enabled !== false 
                ? '<span class="badge enabled">Enabled</span>' 
                : '<span class="badge disabled">Disabled</span>';
            
            const lastSync = conn.lastSync 
                ? this.formatTimeAgo(conn.lastSync) 
                : 'Never';
            
            const syncedCount = conn.syncedPostIds?.length || 0;

            return `
                <div class="connection-card ${conn.enabled === false ? 'disabled' : ''}" data-id="${conn.id}">
                    <div class="connection-avatar">
                        <img src="https://api.tumblr.com/v2/blog/${conn.tumblrBlog}.tumblr.com/avatar/64" 
                             alt="${conn.name}" 
                             onerror="this.parentElement.innerHTML='<i class=\\'fab fa-tumblr\\'></i>'">
                    </div>
                    <div class="connection-info">
                        <h4>
                            ${conn.name || conn.tumblrBlog}
                            ${statusBadge}
                        </h4>
                        <p>
                            <i class="fab fa-tumblr"></i> ${conn.tumblrBlog}.tumblr.com
                        </p>
                        <p>
                            <i class="fab fa-discord"></i> Discord Webhook Connected
                        </p>
                        <div class="connection-stats">
                            <span><i class="fas fa-clock"></i> Last sync: ${lastSync}</span>
                            <span><i class="fas fa-paper-plane"></i> ${syncedCount} posts synced</span>
                        </div>
                    </div>
                    <div class="connection-actions">
                        <button class="btn btn-secondary sync-btn" data-id="${conn.id}" title="Sync now">
                            <i class="fas fa-sync"></i>
                        </button>
                        <button class="btn btn-secondary edit-btn" data-id="${conn.id}" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-danger delete-btn" data-id="${conn.id}" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners
        container.querySelectorAll('.sync-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.syncConnection(btn.dataset.id);
            });
        });

        container.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const connection = Storage.getConnection(btn.dataset.id);
                if (connection) this.openModal(connection);
            });
        });

        container.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteConnection(btn.dataset.id);
            });
        });
    }

    /**
     * Delete connection
     */
    deleteConnection(id) {
        const connection = Storage.getConnection(id);
        if (!connection) return;

        if (confirm(`Are you sure you want to delete the connection for "${connection.name}"?`)) {
            Storage.deleteConnection(id);
            Storage.addActivity({
                type: 'connection_deleted',
                text: `Deleted connection for ${connection.tumblrBlog}`,
                icon: 'info'
            });
            this.renderConnections();
            this.updateDashboard();
            this.showToast('Connection deleted', 'success');
        }
    }

    /**
     * Sync a specific connection
     */
    async syncConnection(connectionId) {
        const connection = Storage.getConnection(connectionId);
        if (!connection) {
            this.showToast('Connection not found', 'error');
            return;
        }

        if (connection.enabled === false) {
            this.showToast('Connection is disabled', 'warning');
            return;
        }

        this.setSyncStatus('syncing');
        this.showToast(`Syncing ${connection.name}...`, 'info');

        try {
            // Get last sync timestamp or default to 24 hours ago
            const lastSync = connection.lastSync 
                ? Math.floor(connection.lastSync / 1000) 
                : Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

            // Fetch new posts
            const posts = await tumblrAPI.getNewPosts(
                connection.tumblrBlog, 
                lastSync, 
                connection.postTypes
            );

            // Filter already synced posts
            const newPosts = posts.filter(post => 
                !Storage.isPostSynced(connectionId, post.id)
            );

            if (newPosts.length === 0) {
                this.showToast(`No new posts for ${connection.name}`, 'info');
                Storage.updateConnection(connectionId, { lastSync: Date.now() });
                this.setSyncStatus('ready');
                return;
            }

            // Post to Discord
            let successCount = 0;
            for (const post of newPosts.reverse()) {
                try {
                    await discordAPI.sendPost(connection.webhookUrl, post);
                    Storage.markPostsAsSynced(connectionId, [post.id]);
                    successCount++;
                } catch (error) {
                    console.error('Failed to post:', error);
                }
            }

            // Update stats
            Storage.incrementSyncedCount(successCount);
            
            Storage.addActivity({
                type: 'sync_complete',
                text: `Synced ${successCount} posts from ${connection.name}`,
                icon: 'success'
            });

            this.showToast(`Synced ${successCount} posts from ${connection.name}`, 'success');
            this.updateDashboard();
            this.renderConnections();
        } catch (error) {
            console.error('Sync error:', error);
            Storage.addActivity({
                type: 'sync_error',
                text: `Error syncing ${connection.name}: ${error.message}`,
                icon: 'error'
            });
            this.showToast(`Sync error: ${error.message}`, 'error');
        } finally {
            this.setSyncStatus('ready');
        }
    }

    /**
     * Sync all enabled connections
     */
    async syncAll() {
        const connections = Storage.getConnections().filter(c => c.enabled !== false);
        
        if (connections.length === 0) {
            this.showToast('No enabled connections to sync', 'warning');
            return;
        }

        this.setSyncStatus('syncing');
        this.showLoading('Syncing all connections...');

        let totalSynced = 0;
        let errors = 0;

        for (const connection of connections) {
            try {
                this.updateLoadingText(`Syncing ${connection.name}...`);
                
                const lastSync = connection.lastSync 
                    ? Math.floor(connection.lastSync / 1000) 
                    : Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

                const posts = await tumblrAPI.getNewPosts(
                    connection.tumblrBlog, 
                    lastSync, 
                    connection.postTypes
                );

                const newPosts = posts.filter(post => 
                    !Storage.isPostSynced(connection.id, post.id)
                );

                for (const post of newPosts.reverse()) {
                    try {
                        await discordAPI.sendPost(connection.webhookUrl, post);
                        Storage.markPostsAsSynced(connection.id, [post.id]);
                        totalSynced++;
                    } catch (error) {
                        console.error('Post error:', error);
                    }
                }

                Storage.updateConnection(connection.id, { lastSync: Date.now() });
            } catch (error) {
                console.error(`Error syncing ${connection.name}:`, error);
                errors++;
            }
        }

        if (totalSynced > 0) {
            Storage.incrementSyncedCount(totalSynced);
        }

        Storage.addActivity({
            type: 'sync_all_complete',
            text: `Synced ${totalSynced} posts from ${connections.length} connections`,
            icon: errors > 0 ? 'warning' : 'success'
        });

        this.hideLoading();
        this.setSyncStatus('ready');
        this.updateDashboard();
        this.renderConnections();

        if (errors > 0) {
            this.showToast(`Synced ${totalSynced} posts with ${errors} errors`, 'warning');
        } else {
            this.showToast(`Synced ${totalSynced} posts successfully`, 'success');
        }
    }

    /**
     * Setup history page
     */
    setupHistoryPage() {
        document.getElementById('fetchHistoryBtn').addEventListener('click', () => {
            this.fetchHistory();
        });

        document.getElementById('selectAllHistory').addEventListener('change', (e) => {
            this.toggleSelectAllHistory(e.target.checked);
        });

        document.getElementById('uploadSelectedBtn').addEventListener('click', () => {
            this.uploadSelectedHistory();
        });
    }

    /**
     * Update history blog filter dropdown
     */
    updateHistoryBlogFilter() {
        const select = document.getElementById('historyBlogFilter');
        const connections = Storage.getConnections();
        
        // Keep first option
        select.innerHTML = '<option value="">All Blogs</option>';
        
        connections.forEach(conn => {
            const option = document.createElement('option');
            option.value = conn.id;
            option.textContent = conn.name || conn.tumblrBlog;
            select.appendChild(option);
        });
    }

    /**
     * Fetch history posts
     */
    async fetchHistory() {
        const connectionId = document.getElementById('historyBlogFilter').value;
        const days = parseInt(document.getElementById('historyDays').value) || 30;

        let connections = Storage.getConnections();
        
        if (connectionId) {
            connections = connections.filter(c => c.id === connectionId);
        }

        if (connections.length === 0) {
            this.showToast('No connections selected', 'warning');
            return;
        }

        this.showLoading('Fetching posts...');
        this.historyPosts = [];
        this.selectedHistoryPosts.clear();

        try {
            for (const connection of connections) {
                this.updateLoadingText(`Fetching from ${connection.name}...`);
                
                console.log(`Fetching history for ${connection.tumblrBlog}, days: ${days}`);
                
                // Fetch ALL post types, don't filter
                const posts = await tumblrAPI.getPostsSince(
                    connection.tumblrBlog, 
                    days, 
                    [] // Empty array = all post types
                );

                console.log(`Got ${posts.length} posts from ${connection.tumblrBlog}`);

                // Add connection info to each post
                posts.forEach(post => {
                    post._connectionId = connection.id;
                    post._connectionName = connection.name;
                    post._webhookUrl = connection.webhookUrl;
                    post._synced = Storage.isPostSynced(connection.id, post.id);
                });

                this.historyPosts.push(...posts);
            }

            // Sort by date descending
            this.historyPosts.sort((a, b) => b.timestamp - a.timestamp);

            console.log(`Total history posts: ${this.historyPosts.length}`);
            
            this.renderHistoryList();
            
            if (this.historyPosts.length === 0) {
                this.showToast(`No posts found in the last ${days} days. Try increasing the days.`, 'warning');
            } else {
                this.showToast(`Found ${this.historyPosts.length} posts`, 'success');
            }
        } catch (error) {
            console.error('Fetch history error:', error);
            this.showToast(`Error fetching history: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Render history list
     */
    renderHistoryList() {
        const container = document.getElementById('historyList');
        
        if (this.historyPosts.length === 0) {
            container.innerHTML = '<p class="empty-state">No posts found</p>';
            document.getElementById('uploadSelectedBtn').disabled = true;
            return;
        }

        container.innerHTML = this.historyPosts.map(post => {
            const formatted = tumblrAPI.formatPostForDisplay(post);
            const isSelected = this.selectedHistoryPosts.has(post.id);
            const typeIcon = CONFIG.POST_TYPE_ICONS[post.type] || '📌';
            
            return `
                <div class="history-item ${isSelected ? 'selected' : ''}" data-id="${post.id}">
                    <div class="history-checkbox">
                        <input type="checkbox" 
                               ${isSelected ? 'checked' : ''} 
                               ${post._synced ? 'disabled' : ''}
                               data-id="${post.id}">
                    </div>
                    <div class="history-content">
                        <h4>${typeIcon} ${formatted.title}</h4>
                        <p>${formatted.summary || 'No description'}</p>
                        <div class="history-meta">
                            <span><i class="fab fa-tumblr"></i> ${post.blog_name}</span>
                            <span><i class="fas fa-clock"></i> ${formatted.date}</span>
                            <span><i class="fas fa-heart"></i> ${formatted.noteCount} notes</span>
                            ${post._synced ? '<span class="badge enabled">Already synced</span>' : ''}
                        </div>
                    </div>
                    ${formatted.images.length > 0 ? `
                        <div class="history-preview">
                            <img src="${formatted.images[0]}" alt="Preview">
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        // Add checkbox listeners
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const postId = parseInt(e.target.dataset.id);
                if (e.target.checked) {
                    this.selectedHistoryPosts.add(postId);
                } else {
                    this.selectedHistoryPosts.delete(postId);
                }
                this.updateHistorySelection();
            });
        });

        this.updateHistorySelection();
    }

    /**
     * Toggle select all history
     */
    toggleSelectAllHistory(selected) {
        this.historyPosts.forEach(post => {
            if (!post._synced) {
                if (selected) {
                    this.selectedHistoryPosts.add(post.id);
                } else {
                    this.selectedHistoryPosts.delete(post.id);
                }
            }
        });
        this.renderHistoryList();
    }

    /**
     * Update history selection UI
     */
    updateHistorySelection() {
        const btn = document.getElementById('uploadSelectedBtn');
        btn.disabled = this.selectedHistoryPosts.size === 0;
        btn.innerHTML = `<i class="fas fa-upload"></i> Upload Selected (${this.selectedHistoryPosts.size})`;
    }

    /**
     * Upload selected history posts
     */
    async uploadSelectedHistory() {
        if (this.selectedHistoryPosts.size === 0) return;

        const selectedPosts = this.historyPosts.filter(p => 
            this.selectedHistoryPosts.has(p.id) && !p._synced
        );

        if (selectedPosts.length === 0) {
            this.showToast('No new posts to upload', 'warning');
            return;
        }

        this.showLoading(`Uploading ${selectedPosts.length} posts...`);

        let successCount = 0;
        let errorCount = 0;

        // Sort by date ascending so older posts appear first in Discord
        selectedPosts.sort((a, b) => a.timestamp - b.timestamp);

        for (const post of selectedPosts) {
            try {
                this.updateLoadingText(`Uploading post ${successCount + errorCount + 1} of ${selectedPosts.length}...`);
                
                await discordAPI.sendPost(post._webhookUrl, post);
                Storage.markPostsAsSynced(post._connectionId, [post.id]);
                post._synced = true;
                successCount++;
            } catch (error) {
                console.error('Upload error:', error);
                errorCount++;
            }
        }

        if (successCount > 0) {
            Storage.incrementSyncedCount(successCount);
            Storage.addActivity({
                type: 'history_upload',
                text: `Uploaded ${successCount} historical posts`,
                icon: 'success'
            });
        }

        this.hideLoading();
        this.selectedHistoryPosts.clear();
        this.renderHistoryList();
        this.updateDashboard();

        if (errorCount > 0) {
            this.showToast(`Uploaded ${successCount} posts, ${errorCount} failed`, 'warning');
        } else {
            this.showToast(`Uploaded ${successCount} posts successfully`, 'success');
        }
    }

    /**
     * Setup settings page
     */
    setupSettingsPage() {
        // Tumblr API config
        document.getElementById('saveTumblrConfig').addEventListener('click', () => {
            const apiKey = document.getElementById('tumblrApiKey').value.trim();
            const corsProxy = document.getElementById('corsProxyUrl').value.trim();
            
            if (!apiKey) {
                this.showToast('Please enter an API key', 'error');
                return;
            }
            Storage.setTumblrApiKey(apiKey);
            tumblrAPI.setApiKey(apiKey);
            
            // Save CORS proxy
            if (corsProxy) {
                localStorage.setItem('tumblr2discord_cors_proxy', corsProxy);
            } else {
                localStorage.removeItem('tumblr2discord_cors_proxy');
            }
            
            this.showToast('Tumblr config saved', 'success');
        });

        // Auto-sync config
        document.getElementById('saveAutoSyncConfig').addEventListener('click', () => {
            const settings = Storage.getSettings();
            settings.autoSyncEnabled = document.getElementById('autoSyncEnabled').checked;
            settings.syncInterval = parseInt(document.getElementById('syncInterval').value) || 15;
            Storage.saveSettings(settings);
            this.setupAutoSync();
            this.showToast('Auto-sync settings saved', 'success');
        });

        // Notification config
        document.getElementById('saveNotificationConfig').addEventListener('click', () => {
            const settings = Storage.getSettings();
            settings.browserNotifications = document.getElementById('browserNotifications').checked;
            settings.soundNotifications = document.getElementById('soundNotifications').checked;
            Storage.saveSettings(settings);
            
            if (settings.browserNotifications) {
                this.requestNotificationPermission();
            }
            
            this.showToast('Notification settings saved', 'success');
        });

        // Export data
        document.getElementById('exportAllData').addEventListener('click', () => this.exportData());

        // Import data
        document.getElementById('importData').addEventListener('click', () => {
            document.getElementById('importFileInput').click();
        });

        document.getElementById('importFileInput').addEventListener('change', (e) => {
            this.importData(e.target.files[0]);
        });

        // Clear data
        document.getElementById('clearAllData').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
                Storage.clearAllData();
                this.showToast('All data cleared', 'success');
                this.loadSettings();
                this.updateDashboard();
                this.renderConnections();
            }
        });
    }

    /**
     * Load settings into UI
     */
    loadSettings() {
        const apiKey = Storage.getTumblrApiKey();
        const settings = Storage.getSettings();
        const corsProxy = localStorage.getItem('tumblr2discord_cors_proxy') || '';

        document.getElementById('tumblrApiKey').value = apiKey;
        document.getElementById('corsProxyUrl').value = corsProxy;
        document.getElementById('autoSyncEnabled').checked = settings.autoSyncEnabled;
        document.getElementById('syncInterval').value = settings.syncInterval;
        document.getElementById('browserNotifications').checked = settings.browserNotifications;
        document.getElementById('soundNotifications').checked = settings.soundNotifications;

        // Update tumblrAPI with key
        tumblrAPI.setApiKey(apiKey);
    }

    /**
     * Setup auto-sync interval
     */
    setupAutoSync() {
        // Clear existing interval
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
        }

        const settings = Storage.getSettings();
        
        if (settings.autoSyncEnabled) {
            const intervalMs = settings.syncInterval * 60 * 1000;
            this.autoSyncInterval = setInterval(() => {
                console.log('Auto-sync triggered');
                this.syncAll();
            }, intervalMs);
            
            console.log(`Auto-sync enabled: every ${settings.syncInterval} minutes`);
        }
    }

    /**
     * Export all data
     */
    exportData() {
        const data = Storage.exportAllData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `tumblr2discord-config-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        this.showToast('Configuration exported', 'success');
    }

    /**
     * Import data from file
     */
    importData(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                Storage.importData(data);
                this.loadSettings();
                this.updateDashboard();
                this.renderConnections();
                this.setupAutoSync();
                this.showToast('Configuration imported successfully', 'success');
            } catch (error) {
                this.showToast('Invalid import file', 'error');
            }
        };
        reader.readAsText(file);
    }

    /**
     * Request notification permission
     */
    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
    }

    /**
     * Set sync status indicator
     */
    setSyncStatus(status) {
        const indicator = document.getElementById('syncIndicator');
        const text = document.getElementById('syncStatusText');
        
        indicator.className = 'status-indicator ' + status;
        
        switch (status) {
            case 'ready':
                text.textContent = 'Ready';
                break;
            case 'syncing':
                text.textContent = 'Syncing...';
                break;
            case 'error':
                text.textContent = 'Error';
                break;
            default:
                text.textContent = status;
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icon = type === 'success' ? 'check-circle' :
                    type === 'error' ? 'times-circle' :
                    type === 'warning' ? 'exclamation-circle' : 'info-circle';
        
        toast.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        // Remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    /**
     * Show loading overlay
     */
    showLoading(text = 'Loading...') {
        document.getElementById('loadingText').textContent = text;
        document.getElementById('loadingOverlay').classList.add('active');
    }

    /**
     * Update loading text
     */
    updateLoadingText(text) {
        document.getElementById('loadingText').textContent = text;
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        document.getElementById('loadingOverlay').classList.remove('active');
    }

    /**
     * Format timestamp as relative time
     */
    formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
        
        return new Date(timestamp).toLocaleDateString();
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
