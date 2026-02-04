/**
 * Cloudflare Worker - CORS Proxy for Tumblr API
 * Deploy this to Cloudflare Workers (free tier: 100k requests/day)
 * 
 * Setup Instructions:
 * 1. Go to https://dash.cloudflare.com/
 * 2. Sign up or login (free)
 * 3. Go to "Workers & Pages" in the sidebar
 * 4. Click "Create Application" -> "Create Worker"
 * 5. Name it "tumblr-cors-proxy"
 * 6. Click "Deploy"
 * 7. Click "Edit Code"
 * 8. Replace all code with this file's contents
 * 9. Click "Save and Deploy"
 * 10. Your worker URL will be: https://tumblr-cors-proxy.YOUR_SUBDOMAIN.workers.dev
 */

export default {
    async fetch(request) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Max-Age': '86400',
                }
            });
        }

        const url = new URL(request.url);
        const targetUrl = url.searchParams.get('url');

        if (!targetUrl) {
            return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        // Only allow Tumblr API requests
        if (!targetUrl.includes('api.tumblr.com')) {
            return new Response(JSON.stringify({ error: 'Only Tumblr API requests allowed' }), {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        try {
            const response = await fetch(targetUrl, {
                method: request.method,
                headers: {
                    'User-Agent': 'Tumblr2Discord/1.0',
                    'Accept': 'application/json'
                }
            });

            const data = await response.text();

            return new Response(data, {
                status: response.status,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Cache-Control': 'public, max-age=60'
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }
};
