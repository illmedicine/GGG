# Tumblr2Discord - Auto-Sync Tumblr Posts to Discord

A frontend web application that automatically syncs posts from Tumblr blogs you follow to your Discord channels using webhooks. Hosted on GitHub Pages for easy access.

![Tumblr to Discord](https://img.shields.io/badge/Tumblr-to-Discord-blue)
![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-green)

## Features

- 🔗 **Multiple Connections**: Connect multiple Tumblr blogs to different Discord channels
- 🔄 **Auto-Sync**: Automatically sync new posts when the app is open
- 📅 **History Backfill**: Upload posts from the past 30+ days
- 🎨 **Rich Embeds**: Posts appear beautifully formatted in Discord with images, videos, and metadata
- ⚙️ **Customizable**: Filter by post types (photos, videos, text, etc.)
- 💾 **Export/Import**: Backup and restore your configuration
- 🌐 **100% Client-Side**: No server required - runs entirely in your browser

## Quick Start

### 1. Get a Tumblr API Key

1. Go to [Tumblr Apps](https://www.tumblr.com/oauth/apps)
2. Click "Register application"
3. Fill in the details:
   - **Application Name**: Tumblr2Discord (or any name)
   - **Application Website**: Your GitHub Pages URL
   - **Default callback URL**: Your GitHub Pages URL
4. Copy the **OAuth Consumer Key** (this is your API key)

### 2. Create a Discord Webhook

1. Open your Discord server
2. Go to **Server Settings** → **Integrations** → **Webhooks**
3. Click **New Webhook**
4. Choose the channel where you want posts to appear
5. Copy the **Webhook URL**

### 3. Configure the App

1. Open the app (hosted on GitHub Pages)
2. Go to **Settings** → Enter your Tumblr API Key → Save
3. Go to **Connections** → Click **New Connection**
4. Enter:
   - Tumblr blog URL (e.g., `xxpeachesncreamxx` or `https://www.tumblr.com/xxpeachesncreamxx`)
   - Discord Webhook URL
   - Select post types to sync
5. Click **Save Connection**

### 4. Sync Posts

- **Manual Sync**: Click "Sync All Now" on the dashboard
- **Individual Sync**: Click the sync button on any connection
- **Auto-Sync**: Enable in Settings to sync every X minutes while the app is open
- **History**: Go to History tab to fetch and upload past posts

## GitHub Pages Deployment

### Option 1: Using Your Repository

1. Fork or clone this repository
2. Go to your repository's **Settings** → **Pages**
3. Under "Source", select **Deploy from a branch**
4. Select `main` branch and `/ (root)` folder
5. Click **Save**
6. Your app will be available at `https://yourusername.github.io/GGG/`

### Option 2: Manual Upload

1. Download all files from this repository
2. Create a new GitHub repository
3. Upload all files to the repository
4. Enable GitHub Pages in repository settings

## Project Structure

```
GGG/
├── index.html          # Main HTML file
├── css/
│   └── styles.css      # Application styles
├── js/
│   ├── config.js       # Configuration constants
│   ├── storage.js      # Local storage management
│   ├── tumblr-api.js   # Tumblr API integration
│   ├── discord-api.js  # Discord webhook integration
│   └── app.js          # Main application logic
└── README.md           # This file
```

## Configuration Options

### Tumblr Settings
- **API Key**: Your Tumblr OAuth Consumer Key (required)

### Auto-Sync Settings
- **Enable Auto-Sync**: Toggle automatic syncing
- **Sync Interval**: How often to check for new posts (5-60 minutes)

### Connection Settings
- **Tumblr Blog**: Blog username or full URL
- **Display Name**: Custom name for the connection
- **Discord Webhook**: Webhook URL for the Discord channel
- **Post Types**: Which types of posts to sync
- **Enabled**: Toggle the connection on/off

## How It Works

1. **Fetching Posts**: The app uses Tumblr's public API to fetch posts from blogs
2. **Rate Limiting**: Requests are rate-limited to avoid API restrictions
3. **Tracking**: Synced posts are tracked to prevent duplicates
4. **Discord Webhooks**: Posts are sent to Discord as rich embeds via webhooks
5. **Local Storage**: All settings are stored in your browser's local storage

## Limitations

- **Client-Side Only**: Auto-sync only works when the app is open in your browser
- **Public Blogs Only**: Can only fetch posts from public Tumblr blogs
- **API Rate Limits**: Tumblr and Discord have rate limits that affect sync speed
- **CORS Proxy**: Uses CORS proxies for API requests which may occasionally be slow

## Troubleshooting

### "Tumblr API key not configured"
- Go to Settings and enter your Tumblr API key

### "Invalid Discord webhook URL"
- Make sure the webhook URL starts with `https://discord.com/api/webhooks/`
- Create a new webhook if the old one was deleted

### Posts not appearing in Discord
- Check that the connection is enabled
- Verify the webhook URL is correct
- Check Discord channel permissions

### "Could not find Tumblr blog"
- Verify the blog exists and is public
- Try using just the username instead of full URL

## Data Privacy

- All data is stored locally in your browser
- No data is sent to external servers except Tumblr and Discord APIs
- Your API key and webhook URLs are never shared
- Use the Export feature to backup your data

## Contributing

Feel free to submit issues and pull requests to improve the app!

## License

MIT License - Feel free to use and modify as needed.

---

**Note**: This app is not affiliated with Tumblr or Discord. Use responsibly and respect rate limits.
