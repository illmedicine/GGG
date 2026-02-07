/**
 * Cloudflare Worker - Media ID Lookup
 *
 * Features:
 * - GET /lookup?connectionId=...&mediaId=...  -> returns { tumblrPostId }
 * - POST /upload (requires X-API-Key header) -> stores media map (if KV `MEDIA_MAP` is bound)
 *
 * CONFIGURATION:
 * - Set a secret API key in worker environment as `MEDIA_LOOKUP_SECRET` to allow uploads.
 * - Bind a Workers KV namespace to binding name `MEDIA_MAP` (optional). If not bound, the worker
 *   will attempt to fetch the mapping from a configured `MAPPING_URL` query param or return instructions.
 *
 * SECURITY: Protect the /upload endpoint with a secret and restrict who can call it.
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '');

  if (pathname === '/lookup' && request.method === 'GET') {
    const connectionId = url.searchParams.get('connectionId');
    const mediaId = url.searchParams.get('mediaId');

    if (!connectionId || !mediaId) {
      return jsonResponse({ error: 'connectionId and mediaId are required' }, 400);
    }

    // Load map from KV if available, else try configured MAPPING_URL
    let mapObj = null;

    if (typeof MEDIA_MAP !== 'undefined' && MEDIA_MAP) {
      try {
        const data = await MEDIA_MAP.get('media_map');
        if (data) mapObj = JSON.parse(data);
      } catch (e) {
        return jsonResponse({ error: 'Error reading from KV: ' + e.message }, 500);
      }
    }

    if (!mapObj) {
      // Optionally allow specifying a mapping URL in query string (MAPPING_URL)
      const mappingUrl = url.searchParams.get('mappingUrl');
      if (mappingUrl) {
        try {
          const resp = await fetch(mappingUrl);
          if (resp.ok) {
            const json = await resp.json();
            mapObj = json.map || json;
          }
        } catch (e) {
          return jsonResponse({ error: 'Failed to fetch mapping from mappingUrl: ' + e.message }, 502);
        }
      }
    }

    if (!mapObj) {
      return jsonResponse({ error: 'No media map available. Upload one via /upload or bind a KV namespace `MEDIA_MAP`.' }, 404);
    }

    const connMap = mapObj[connectionId];
    if (!connMap) return jsonResponse({ error: 'Connection not found in map' }, 404);

    const tumblrPostId = connMap[mediaId];
    if (!tumblrPostId) return jsonResponse({ error: 'Media ID not found for connection' }, 404);

    return jsonResponse({ connectionId, mediaId, tumblrPostId });
  }

  if (pathname === '/upload' && request.method === 'POST') {
    // Require secret
    const secret = request.headers.get('X-API-Key');
    if (!secret || secret !== MEDIA_LOOKUP_SECRET) {
      return jsonResponse({ error: 'Invalid or missing API key' }, 403);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    // Expect { map: { [connectionId]: { [mediaId]: tumblrPostId } } }
    const map = body.map || body;
    if (!map || typeof map !== 'object') {
      return jsonResponse({ error: 'Invalid map payload' }, 400);
    }

    if (typeof MEDIA_MAP !== 'undefined' && MEDIA_MAP) {
      try {
        await MEDIA_MAP.put('media_map', JSON.stringify(map));
        return jsonResponse({ ok: true, message: 'Map saved to KV' });
      } catch (e) {
        return jsonResponse({ error: 'Failed to write to KV: ' + e.message }, 500);
      }
    }

    // If KV not bound, we can respond with instructions on how to set it up
    return jsonResponse({ error: 'No KV binding found (MEDIA_MAP). Bind a Workers KV namespace or use a different hosting method.' }, 501);
  }

  if (pathname === '/health') {
    return jsonResponse({ ok: true, service: 'media-lookup-worker' });
  }

  return jsonResponse({ message: 'Media Lookup Worker. Use GET /lookup or POST /upload' }, 200);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}