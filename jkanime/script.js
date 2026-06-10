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
    var char;
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
        console.log('soraFetch: Calling fetchv2 for ' + url);
        const res = await fetchv2(url, headers, method, body);
        let textRes = res;
        if (res) {
            if (typeof res.text === 'function') {
                textRes = await res.text();
            } else if (typeof res === 'object' && res._data !== undefined) {
                textRes = res._data;
            } else if (typeof res === 'object' && res.body !== undefined) {
                textRes = res.body;
            }
        }
        console.log('soraFetch: fetchv2 success, text length = ' + (textRes ? textRes.length : 0));
        return textRes;
    } catch(e) {
        console.log('soraFetch: fetchv2 failed, error: ' + e.message + '. Trying fallback fetch...');
        try {
            const res = await fetch(url, {
                method: method,
                headers: headers,
                body: body
            });
            let textRes = res;
            if (res) {
                if (typeof res.text === 'function') {
                    textRes = await res.text();
                } else if (typeof res === 'object' && res._data !== undefined) {
                    textRes = res._data;
                } else if (typeof res === 'object' && res.body !== undefined) {
                    textRes = res.body;
                }
            }
            console.log('soraFetch: fallback fetch success, text length = ' + (textRes ? textRes.length : 0));
            return textRes;
        } catch(error) {
            console.log('soraFetch: fallback fetch error: ' + error.message);
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
        console.log('searchResults: keyword = ' + keyword);
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
        
        console.log('searchResults: found ' + results.length + ' results');
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
        console.log('extractDetails: url = ' + url);
        const responseText = await soraFetch(url);
        if (!responseText) return JSON.stringify({ description: 'No description available', aliases: 'Estado: Unknown', airdate: 'Aired: Unknown' });

        const descMatch = responseText.match(/<p class="scroll">([\s\S]*?)<\/p>/);
        const description = descMatch ? descMatch[1].trim().replace(/<[^>]*>/g, '') : 'No description available';

        const airMatch = responseText.match(/<li><span>\s*Emitido:\s*<\/span>\s*([^<]+)<\/li>/);
        const airdate = airMatch ? airMatch[1].trim() : 'Unknown';

        const statusMatch = responseText.match(/<li><span>\s*Estado:\s*<\/span>\s*<div[^>]*>([^<]+)<\/div>/);
        const status = statusMatch ? statusMatch[1].trim() : 'Unknown';

        console.log('extractDetails: successfully parsed details');
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
        console.log('extractEpisodes: url = ' + url);
        const html = await soraFetch(url);
        if (!html) {
            console.log('extractEpisodes: html content is empty');
            return JSON.stringify([]);
        }
        
        console.log('extractEpisodes: html length = ' + html.length);
        console.log('extractEpisodes: html start = ' + html.substring(0, 200));

        const slugMatch = url.match(/https?:\/\/(?:www\.)?jkanime\.net\/([^\/]+)/);
        const slug = slugMatch ? slugMatch[1] : '';
        console.log('extractEpisodes: slug = ' + slug);

        const csrfToken = html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1];
        const animeId = html.match(/data-anime="(\d+)"/)?.[1];
        console.log('extractEpisodes: csrfToken = ' + csrfToken + ', animeId = ' + animeId);

        // 1. Try to fetch total episodes via JKanime's AJAX episodes endpoint
        if (csrfToken && animeId) {
            try {
                const ajaxUrl = 'https://jkanime.net/ajax/episodes/' + animeId + '/1';
                console.log('extractEpisodes: making AJAX POST to ' + ajaxUrl);
                const responseText = await soraFetch(ajaxUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: '_token=' + encodeURIComponent(csrfToken)
                });
                console.log('extractEpisodes: AJAX response = ' + responseText);
                const data = JSON.parse(responseText);
                if (data && data.total) {
                    const episodes = [];
                    for (let i = 1; i <= data.total; i++) {
                        episodes.push({
                            href: 'https://jkanime.net/' + slug + '/' + i + '/',
                            number: i
                        });
                    }
                    console.log('extractEpisodes: returning ' + episodes.length + ' episodes from AJAX');
                    return JSON.stringify(episodes);
                }
            } catch (e) {
                console.log('AJAX episodes fetch failed: ' + e.message);
            }
        }

        // 2. Fallback: Parse the static number of episodes (works only for completed series)
        const epMatch = html.match(/<li><span>\s*Episodios:\s*<\/span>\s*([^<]+)<\/li>/);
        const totalEps = epMatch ? parseInt(epMatch[1].trim(), 10) : 0;
        console.log('extractEpisodes: totalEps from fallback = ' + totalEps);
        const episodes = [];
        if (totalEps > 0) {
            for (let i = 1; i <= totalEps; i++) {
                episodes.push({
                    href: 'https://jkanime.net/' + slug + '/' + i + '/',
                    number: i
                });
            }
        }
        console.log('extractEpisodes: returning ' + episodes.length + ' episodes from fallback');
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
/** extractStreamUrl
 * Extracts all stream server options for a specific episode page URL.
 * @param {string} url - The URL of the episode page.
 * @returns {Promise<string>} - A JSON string with a list of stream server options.
 */
async function extractStreamUrl(url) {
    try {
        console.log('extractStreamUrl: url = ' + url);
        const html = await soraFetch(url);
        if (!html) return JSON.stringify({ streams: [] });

        const streams = [];
        const promises = [];

        // 1. Resolve Desu and Magi players from video[] iframe matches
        const videoRegex = /video\[(\d+)\]\s*=\s*['"]<iframe[^>]*?src="([^"]+)"/g;
        let videoMatch;
        while ((videoMatch = videoRegex.exec(html)) !== null) {
            const idx = videoMatch[1];
            const iframeSrc = videoMatch[2];
            const title = idx === '0' ? 'Desu' : idx === '1' ? 'Magi' : 'Video ' + idx;

            promises.push((async () => {
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
                    // Skip unsupported download-only or end-to-end encrypted servers (Mediafire, Mega)
                    if (serverName === 'Mediafire' || serverName === 'Mega') continue;
                    
                    const remoteB64 = s.remote;
                    if (remoteB64) {
                        const decodedUrl = base64Decode(remoteB64).trim();
                        if (decodedUrl) {
                            promises.push((async () => {
                                try {
                                    let resolvedUrl = null;
                                    if (serverName === 'Mp4upload') {
                                        resolvedUrl = await extractMp4upload(decodedUrl);
                                    } else if (serverName === 'Streamwish') {
                                        resolvedUrl = await extractStreamwish(decodedUrl);
                                    } else if (serverName === 'VOE') {
                                        resolvedUrl = await extractVOE(decodedUrl);
                                    } else if (serverName === 'Vidhide') {
                                        resolvedUrl = await extractVidhide(decodedUrl);
                                    } else if (serverName === 'Doodstream') {
                                        resolvedUrl = await extractDoodstream(decodedUrl);
                                    } else if (serverName === 'Streamtape') {
                                        resolvedUrl = await extractStreamtape(decodedUrl);
                                    }
                                    
                                    if (resolvedUrl) {
                                        streams.push({
                                            title: serverName,
                                            streamUrl: resolvedUrl,
                                            headers: { 'Referer': decodedUrl }
                                        });
                                    }
                                } catch (err) {
                                    console.log('Failed to extract stream for ' + serverName + ': ' + err.message);
                                }
                            })());
                        }
                    }
                }
            } catch (e) {
                console.log('Failed to parse servers list: ' + e.message);
            }
        }

        // Wait for all player and server extractions to finish
        await Promise.all(promises);

        console.log('extractStreamUrl: resolved ' + streams.length + ' stream URLs');
        return JSON.stringify({ streams: streams });
    } catch (error) {
        console.log('extractStreamUrl error: ' + error.message);
        return JSON.stringify({ streams: [] });
    }
}

/** --- Unbaser class for Dean Edwards Packer --- */
class Unbaser {
    constructor(base) {
        this.ALPHABET = {
            62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            95: "' !\"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'",
        };
        this.dictionary = {};
        this.base = base;
        if (36 < base && base < 62) {
            this.ALPHABET[base] = this.ALPHABET[base] ||
                this.ALPHABET[62].substring(0, base);
        }
        if (2 <= base && base <= 36) {
            this.unbase = (value) => parseInt(value, base);
        } else {
            try {
                const alphabet = this.ALPHABET[base] || "";
                for (let i = 0; i < alphabet.length; i++) {
                    this.dictionary[alphabet.charAt(i)] = i;
                }
            } catch (er) {
                console.log("Unbaser initialization failed: " + er.message);
            }
            this.unbase = this._dictunbaser;
        }
    }
    _dictunbaser(value) {
        let ret = 0;
        const valStr = String(value);
        for (let i = 0; i < valStr.length; i++) {
            const cipher = valStr.charAt(valStr.length - 1 - i);
            ret = ret + (Math.pow(this.base, i) * (this.dictionary[cipher] || 0));
        }
        return ret;
    }
}

/** --- Unpacks Dean Edwards Packer obfuscated scripts --- */
function unpack(source) {
    let payload, symtab, radix, count;
    const juicers = [
        /}\('(.*)',\s*(\d+|\[\]),\s*(\d+),\s*'(.*)'\.split\('\|'\),\s*(\d+),\s*(.*)\)\)/,
        /}\('(.*)',\s*(\d+|\[\]),\s*(\d+),\s*'(.*)'\.split\('\|'\)/
    ];
    for (let i = 0; i < juicers.length; i++) {
        const args = juicers[i].exec(source);
        if (args) {
            payload = args[1];
            symtab = args[4].split("|");
            radix = parseInt(args[2]);
            count = parseInt(args[3]);
            break;
        }
    }
    if (!payload || count !== symtab.length) {
        return source;
    }
    let unbase;
    try {
        unbase = new Unbaser(radix);
    } catch (e) {
        return source;
    }
    function lookup(match) {
        let idx;
        if (radix === 1) {
            idx = parseInt(match);
        } else {
            idx = unbase.unbase(match);
        }
        return symtab[idx] || match;
    }
    return payload.replace(/\b\w+\b/g, lookup);
}

/** --- Helper to decode Base64 safely with padding check --- */
function safeBase64Decode(str) {
    let s = str.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) {
        s += '=';
    }
    return base64Decode(s);
}

/** --- Mp4upload Extractor --- */
async function extractMp4upload(embedUrl) {
    const html = await soraFetch(embedUrl);
    if (!html) return null;
    const match = html.match(/src:\s*"([^"]+)"/);
    return match ? match[1] : null;
}

/** --- Streamwish Extractor --- */
async function extractStreamwish(embedUrl) {
    const html = await soraFetch(embedUrl);
    if (!html) return null;
    const obfuscatedScript = html.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d.*?\)[\s\S]*?)<\/script>/);
    if (obfuscatedScript) {
        const unpacked = unpack(obfuscatedScript[1]);
        const m3u8Match = unpacked.match(/(https?:\/\/[^\s"'`]+master\.m3u8[^\s"'`]*)/) || unpacked.match(/(https?:\/\/[^\s"'`]+\.m3u8[^\s"'`]*)/);
        return m3u8Match ? m3u8Match[1] : null;
    }
    return null;
}

/** --- Vidhide Extractor --- */
async function extractVidhide(embedUrl) {
    return await extractStreamwish(embedUrl);
}

/** --- VOE Extractor --- */
function voeRot13(str) {
    return str.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode(
            (c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26
        );
    });
}
function voeRemovePatterns(str) {
    const patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
    let result = str;
    for (let i = 0; i < patterns.length; i++) {
        result = result.split(patterns[i]).join("");
    }
    return result;
}
function voeShiftChars(str, shift) {
    let result = "";
    for (let i = 0; i < str.length; i++) {
        result += String.fromCharCode(str.charCodeAt(i) - shift);
    }
    return result;
}

async function extractVOE(embedUrl) {
    let html = await soraFetch(embedUrl);
    if (!html) return null;
    
    // Follow window.location redirect if present
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    if (titleMatch && titleMatch[1].toLowerCase().includes("redirect")) {
        const redirectRegexes = [
            /<meta http-equiv="refresh" content="0;url=(.*?)"/,
            /window\.location\.href\s*=\s*["'](.*?)["']/,
            /window\.location\.replace\s*\(\s*["'](.*?)["']\s*\)/,
            /window\.location\s*=\s*["'](.*?)["']/,
            /window\.location\.assign\s*\(\s*["'](.*?)["']\s*\)/,
            /top\.location\s*=\s*["'](.*?)["']/,
            /top\.location\.replace\s*\(\s*["'](.*?)["']\s*\)/
        ];
        for (let i = 0; i < redirectRegexes.length; i++) {
            const match = html.match(redirectRegexes[i]);
            if (match && match[1] && match[1].startsWith("http")) {
                console.log("VOE: following redirect to " + match[1]);
                html = await soraFetch(match[1]);
                break;
            }
        }
    }
    
    if (!html) return null;
    
    const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!jsonScriptMatch) return null;
    
    const obfuscatedJson = jsonScriptMatch[1].trim();
    const data = JSON.parse(obfuscatedJson);
    if (!Array.isArray(data) || typeof data[0] !== "string") return null;
    
    const obfuscatedString = data[0];
    const step1 = voeRot13(obfuscatedString);
    const step2 = voeRemovePatterns(step1);
    const step3 = safeBase64Decode(step2);
    const step4 = voeShiftChars(step3, 3);
    const step5 = step4.split("").reverse().join("");
    const step6 = safeBase64Decode(step5);
    
    const result = JSON.parse(step6);
    if (result && typeof result === "object") {
        return result.direct_access_url || (result.source && result.source[0] && (result.source[0].direct_access_url || result.source[0].file)) || null;
    }
    return null;
}

/** --- Doodstream Extractor --- */
function randomStr(length) {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

async function extractDoodstream(embedUrl) {
    const html = await soraFetch(embedUrl);
    if (!html) return null;
    
    const domainMatch = embedUrl.match(/https?:\/\/([^\/]+)/);
    if (!domainMatch) return null;
    const streamDomain = domainMatch[1];
    
    const md5Match = html.match(/'\/pass_md5\/(.*?)',/);
    if (!md5Match) return null;
    const md5Path = md5Match[1];
    const token = md5Path.substring(md5Path.lastIndexOf("/") + 1);
    const expiryTimestamp = new Date().valueOf();
    const random = randomStr(10);
    
    const passUrl = "https://" + streamDomain + "/pass_md5/" + md5Path;
    const passResponse = await soraFetch(passUrl, {
        headers: { "Referer": embedUrl }
    });
    if (!passResponse) return null;
    
    const videoUrl = passResponse.trim() + random + "?token=" + token + "&expiry=" + expiryTimestamp;
    return videoUrl;
}

/** --- Streamtape Extractor --- */
async function extractStreamtape(embedUrl) {
    const html = await soraFetch(embedUrl);
    if (!html) return null;
    
    const domainMatch = embedUrl.match(/https?:\/\/([^\/]+)/);
    if (!domainMatch) return null;
    const streamDomain = domainMatch[1];
    
    const scriptMatch = html.match(/document\.getElementById\('robotlink'\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*'([^']+)'/);
    if (!scriptMatch) return null;
    
    const p1 = scriptMatch[1];
    const p2 = scriptMatch[2].substring(3);
    const streamUrl = "https://" + streamDomain + p1 + p2;
    return streamUrl;
}
