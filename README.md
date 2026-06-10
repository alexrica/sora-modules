# Sora Modules: JKanime

This repository contains custom streaming modules for **Sora** and **Luna** media players. The main module is **JKanime** (version `1.0.0`), a Spanish-subtitled anime provider.

Below is a detailed guide on the advanced features, scraping strategies, and decryption algorithms implemented in this module that are **not covered in the official Sora Module Creator Guide**.

---

## 1. Advanced Environmental Compatibility: `fetchv2` Output Handling

The official Sora creator guide assumes that the custom `fetchv2` function returns a raw string response. However, depending on the client implementation (e.g., **Luna** for iOS/macOS versus older **Sora** runtimes), `fetchv2` may return a `Response` wrapper object.

To prevent runtime errors, our custom `soraFetch` wrapper dynamically checks and extracts the response body across different runtime behaviors:

```javascript
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
```

---

## 2. Dynamic Laravel CSRF & AJAX Episode Scraper

For airing series, JKanime's static HTML does not list all episodes to avoid page recaching delays. Instead, it loads them asynchronously. The official guide only teaches parsing static HTML elements.

We solved this by simulating JKanime's AJAX requests:
1. **CSRF & Anime ID Extraction**: Parse the CSRF token and internal anime identifier directly from the anime detail page:
   ```javascript
   const csrfToken = html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1];
   const animeId = html.match(/data-anime="(\d+)"/)?.[1];
   ```
2. **AJAX POST Simulation**: Execute a POST request to JKanime's episodes endpoint, supplying the extracted token in the header and body:
   ```javascript
   const ajaxUrl = 'https://jkanime.net/ajax/episodes/' + animeId + '/1';
   const responseText = await soraFetch(ajaxUrl, {
       method: 'POST',
       headers: {
           'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
           'X-Requested-With': 'XMLHttpRequest'
       },
       body: '_token=' + encodeURIComponent(csrfToken)
   });
   ```

---

## 3. Dean Edwards P.A.C.K.E.R. Deobfuscation (Streamwish & Vidhide)

Many popular video hosts obfuscate their video players using the Dean Edwards Packer format (`eval(function(p,a,c,k,e,d)...`). Since mobile video players cannot run a full web page sandbox to execute the obfuscated script, the module must unpack the script manually in JavaScript.

We implemented a custom `Unbaser` class and `unpack` helper:
* **The Radix Dictionary**: Decodes base-N strings (supporting base-62 and base-95) back into lookup indexes.
* **Symbol Table Mapping**: Replaces the obfuscated tokens in the packed payload with the actual strings from the symbol table.
* **HLS Stream Extraction**: Once unpacked, a simple regular expression extracts the direct `.m3u8` playlist URL:
  ```javascript
  const m3u8Match = unpacked.match(/(https?:\/\/[^\s"'`]+master\.m3u8[^\s"'`]*)/);
  ```

This allows **Streamwish** and **Vidhide** to resolve directly to direct HLS playback options.

---

## 4. Custom ROT13 + Shift Decryption (VOE Server)

The **VOE** stream host embeds its playback configurations inside a base64-like string hidden in an `application/json` script tag. It uses a multi-step custom cipher:

1. **ROT13**: Rotate alphabetical characters by 13 positions.
2. **Pattern Stripping**: Remove specific dummy pattern pairs (e.g. `@$`, `^^`, `~@`, `%?`, `*~`, `!!`, `#&`).
3. **Base64 Decode**: Decode the stripped string to UTF-8.
4. **Character Shifting**: Subtract `3` from the character code of each letter.
5. **String Reversing**: Reverse the sequence of characters.
6. **Final Base64 Decode & Parse**: Perform a second Base64 decode and parse the resulting JSON string to read the `direct_access_url` property.

Our JS implementation runs this entire decryption pipeline in real-time, providing direct `.mp4` video paths.

---

## 5. Doodstream Signature Resolver (`pass_md5`)

**Doodstream** protects its streams by requiring a temporary MD5 pass token.
1. Match the `'/pass_md5/...` path inside the Doodstream embed HTML.
2. Query the Doodstream backend: `https://{domain}/pass_md5/{md5Path}` with the `Referer` header set to the embed URL.
3. Append a random 10-character string along with the token and expiry timestamp to generate the final playable video stream URL:
   ```javascript
   const videoUrl = passResponse.trim() + randomSuffix + "?token=" + token + "&expiry=" + expiryTimestamp;
   ```

---

## 6. Streamtape Robotlink Resolution

**Streamtape** splits its video URL in the DOM using a script that concatenates two parts and trims characters to bypass basic web scrapers. We resolve this by finding the `robotlink` script in the HTML:
```javascript
const scriptMatch = html.match(/document\.getElementById\('robotlink'\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*'([^']+)'/);
const p1 = scriptMatch[1];
const p2 = scriptMatch[2].substring(3); // Skip the offset characters
const streamUrl = "https://" + streamDomain + p1 + p2;
```

---

## 7. Filtering Unstreamable Servers (Mega & Mediafire)

Luna and Sora require direct media streams (like `.m3u8` HLS playlists or raw `.mp4` files) to play content within their native player. 
* **Mega.nz**: Employs custom end-to-end client-side encryption. Resolving this would require downloading and decrypting the file chunk-by-chunk in memory, which is extremely slow and resource-heavy.
* **Mediafire**: Acts as a download portal, not a streaming server.

To provide a premium and error-free user experience, **we explicitly skip and filter out Mega and Mediafire links**, displaying only the successfully resolved direct video URLs to the user.