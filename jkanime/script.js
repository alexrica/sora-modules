/** JKanime Sora Module
 * 
 * Provides access to search, details, episodes, and video streaming links
 * from JKanime (https://jkanime.net/).
 */

/** Helper function to decode Base64 strings.
 * Falls back to native methods or a manual implementation.
 */
function base64Decode(str) {
    try {
        if (typeof atob === 'function') return atob(str);
        if (typeof Buffer === 'function') return Buffer.from(str, 'base64').toString('utf-8');
    } catch (e) {}
    
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var output = '';
    str = String(str).replace(/=+$/, '');
    if (str.length % 4 === 1) {
        return '';
    }
    for (var bc = 0, bs, buffer, idx = 0; char = str.charAt(idx++); ~char && (bs = bc % 4 ? buffer * 64 + bs : bs, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
        char = chars.indexOf(char);
    }
    return output;
}

/** Fetch wrapper that uses Sora's custom fetchv2 and falls back to standard fetch.
 */
async function soraFetch(url, options = {}) {
    const headers = options.headers ?? {};
    const method = options.method ?? 'GET';
    const body = options.body ?? null;
    
    // Inject default browser User-Agent to prevent Cloudflare/403 blocks
    if (!headers['User-Agent'] && !headers['user-agent']) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';
    }
    
    try {
        return await fetchv2(url, headers, method, body);
    } catch(e) {
        try {
            const res = await fetch(url, {
                method: method,
                headers: headers,
                body: body
            });
            if (typeof res.text === 'function') {
                return await res.text();
            }
            return res;
        } catch(error) {
            console.log('soraFetch error: ' + error.message);
            return null;
        }
    }
}

/** searchResults
 * Searches for anime based on a keyword.
 * @param {string} keyword - The search keyword.
 * @returns {Promise<string>} - A JSON string of search results.
 */
async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const responseText = await soraFetch('https://jkanime.net/buscar?q=' + encodedKeyword);
        if (!responseText) return JSON.stringify([]);

        const regex = /<div class="anime__item">[\s\S]*?<a\s+href="([^"]+)"[\s\S]*?data-setbg="([^"]+)"[\s\S]*?<h5><a\s+href="[^"]+">([^<]+)<\/a><\/h5>/g;
        const results = [];
        let match;
        while ((match = regex.exec(responseText)) !== null) {
            results.push({
                title: match[3].trim(),
                image: match[2].trim(),
                href: match[1].trim()
            });
        }
        
        return JSON.stringify(results);
    } catch (error) {
        console.log('searchResults error: ' + error.message);
        return JSON.stringify([]);
    }
}

/** extractDetails
 * Extracts details of an anime from its main page URL.
 * @param {string} url - The URL of the anime page.
 * @returns {Promise<string>} - A JSON string of the anime details.
 */
async function extractDetails(url) {
    try {
        const responseText = await soraFetch(url);
        if (!responseText) return JSON.stringify({ description: 'No description available', aliases: 'Estado: Unknown', airdate: 'Aired: Unknown' });

        const descMatch = responseText.match(/<p class="scroll">([\s\S]*?)<\/p>/);
        const description = descMatch ? descMatch[1].trim().replace(/<[^>]*>/g, '') : 'No description available';

        const airMatch = responseText.match(/<li><span>\s*Emitido:\s*<\/span>\s*([^<]+)<\/li>/);
        const airdate = airMatch ? airMatch[1].trim() : 'Unknown';

        const statusMatch = responseText.match(/<li><span>\s*Estado:\s*<\/span>\s*<div[^>]*>([^<]+)<\/div>/);
        const status = statusMatch ? statusMatch[1].trim() : 'Unknown';

        return JSON.stringify({
            description: description,
            aliases: 'Estado: ' + status,
            airdate: 'Aired: ' + airdate
        });
    } catch (error) {
        console.log('extractDetails error: ' + error.message);
        return JSON.stringify({
            description: 'Error loading description',
            aliases: 'Estado: Unknown',
            airdate: 'Aired: Unknown'
        });
    }
}

/** extractEpisodes
 * Extracts episodes list of an anime from its main page URL.
 * @param {string} url - The URL of the anime page.
 * @returns {Promise<string>} - A JSON string of the episodes list.
 */
async function extractEpisodes(url) {
    try {
        const html = await soraFetch(url);
        if (!html) return JSON.stringify([]);

        const slug = url.replace('https://jkanime.net/', '').replace(/\//g, '').trim();
        const csrfToken = html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1];
        const animeId = html.match(/data-anime="(\d+)"/)?.[1];

        // 1. Try to fetch total episodes via JKanime's AJAX episodes endpoint
        if (csrfToken && animeId) {
            try {
                const ajaxUrl = 'https://jkanime.net/ajax/episodes/' + animeId + '/1';
                const responseText = await soraFetch(ajaxUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: '_token=' + encodeURIComponent(csrfToken)
                });
                const data = JSON.parse(responseText);
                if (data && data.total) {
                    const episodes = [];
                    for (let i = 1; i <= data.total; i++) {
                        episodes.push({
                            href: 'https://jkanime.net/' + slug + '/' + i + '/',
                            number: i
                        });
                    }
                    return JSON.stringify(episodes);
                }
            } catch (e) {
                console.log('AJAX episodes fetch failed: ' + e.message);
            }
        }

        // 2. Fallback: Parse the static number of episodes (works only for completed series)
        const epMatch = html.match(/<li><span>\s*Episodios:\s*<\/span>\s*([^<]+)</li>/);
        const totalEps = epMatch ? parseInt(epMatch[1].trim(), 10) : 0;
        const episodes = [];
        if (totalEps > 0) {
            for (let i = 1; i <= totalEps; i++) {
                episodes.push({
                    href: 'https://jkanime.net/' + slug + '/' + i + '/',
                    number: i
                });
            }
        }
        return JSON.stringify(episodes);
    } catch (error) {
        console.log('extractEpisodes error: ' + error.message);
        return JSON.stringify([]);
    }
}

/** extractStreamUrl
 * Extracts all stream server options for a specific episode page URL.
 * @param {string} url - The URL of the episode page.
 * @returns {Promise<string>} - A JSON string with a list of stream server options.
 */
async function extractStreamUrl(url) {
    try {
        const html = await soraFetch(url);
        if (!html) return JSON.stringify({ streams: [] });

        const streams = [];
        const iframePromises = [];

        // 1. Resolve Desu and Magi players from video[] iframe matches
        const videoRegex = /video\[(\d+)\]\s*=\s*['"]<iframe[^>]*?src="([^"]+)"/g;
        let videoMatch;
        while ((videoMatch = videoRegex.exec(html)) !== null) {
            const idx = videoMatch[1];
            const iframeSrc = videoMatch[2];
            const title = idx === '0' ? 'Desu' : idx === '1' ? 'Magi' : 'Video ' + idx;

            iframePromises.push((async () => {
                try {
                    const playerHtml = await soraFetch(iframeSrc);
                    if (!playerHtml) return;

                    if (idx === '0') {
                        // Desu player URL is in DPlayer config: url: '...'
                        const urlMatch = playerHtml.match(/url:\s*'([^']+)'/);
                        if (urlMatch) {
                            streams.push({
                                title: title,
                                streamUrl: urlMatch[1],
                                headers: { 'Referer': 'https://jkanime.net/' }
                            });
                        }
                    } else if (idx === '1') {
                        // Magi player URL is in HTML source tag: <source src='...'>
                        const urlMatch = playerHtml.match(/<source\s+src='([^']+)'/) || playerHtml.match(/src:\s*'([^']+)'/);
                        if (urlMatch) {
                            streams.push({
                                title: title,
                                streamUrl: urlMatch[1],
                                headers: { 'Referer': 'https://jkanime.net/' }
                            });
                        }
                    }
                } catch (e) {
                    console.log('Failed to resolve player ' + title + ': ' + e.message);
                }
            })());
        }

        // 2. Resolve other external servers from the servers variable
        const serversMatch = html.match(/var servers\s*=\s*(\[.*?\]);/);
        if (serversMatch) {
            try {
                const serversList = JSON.parse(serversMatch[1]);
                for (let i = 0; i < serversList.length; i++) {
                    const s = serversList[i];
                    const serverName = s.server;
                    if (serverName === 'Mediafire') continue; // Mediafire is downloads only
                    
                    const remoteB64 = s.remote;
                    if (remoteB64) {
                        const decodedUrl = base64Decode(remoteB64).trim();
                        if (decodedUrl) {
                            streams.push({
                                title: serverName,
                                streamUrl: decodedUrl,
                                headers: { 'Referer': 'https://jkanime.net/' }
                            });
                        }
                    }
                }
            } catch (e) {
                console.log('Failed to parse servers list: ' + e.message);
            }
        }

        // Wait for Desu/Magi iframe pages to resolve
        await Promise.all(iframePromises);

        return JSON.stringify({ streams: streams });
    } catch (error) {
        console.log('extractStreamUrl error: ' + error.message);
        return JSON.stringify({ streams: [] });
    }
}
