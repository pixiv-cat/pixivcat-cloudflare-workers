addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

const credentials = {
    refresh_token: 'Ph-2YeWnfl0ycjM1AsIW0_JtvVd2BBGfnWuGUS7Aqps',
    access_token: '',
    refresh_token_expiry: 0
}

function _checkRequest(request) {
    const url = new URL(request.url);
    if (/^\/(\d+)-(\d+).(jpg|png|gif)$/.test(url.pathname)) {
        let result = /^\/(\d+)-(\d+).(jpg|png|gif)$/.exec(url.pathname);
        return {
            is_valid: true,
            is_manga: true,
            pixiv_id: result[1],
            pixiv_page: result[2] - 1
        };
    } else if (/^\/(\d+)\.(jpg|png|gif)/.test(url.pathname)) {
        let result = /^\/(\d+)\.(jpg|png|gif)/.exec(url.pathname);
        return {
            is_valid: true,
            is_manga: false,
            pixiv_id: result[1]
        };
    } else {
        return {
            is_valid: false,
            is_manga: false
        };
    }
}

function _parseFilenameFromUrl(url) {
    return url.substring(url.lastIndexOf('/') + 1)
}

async function _getToken() {
    if (Date.now() > credentials.refresh_token_expiry) {
        const url = new URL('https://oauth.secure.pixiv.net/auth/token');
        let formData = new FormData();
        formData.append('grant_type', 'refresh_token');
        formData.append('refresh_token', credentials.refresh_token);
        formData.append('client_id', 'MOBrBDS8blbauoSck0ZfDbtuzpyT');
        formData.append('client_secret', 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj');
        formData.append('hash_secret', '28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c');
        const refreshToken = new Request(url, {
            method: "POST",
            headers: {
                'App-OS': 'ios',
                'App-OS-Version': '10.3.1',
                'App-Version': '6.7.1',
                'User-Agent': 'PixivIOSApp/6.7.1 (iOS 10.3.1; iPhone8,1)',
            },
            body: formData
        })
        const res = await fetch(refreshToken);
        const apiResult = await res.json();
        credentials.access_token = apiResult['response'].access_token;
        credentials.refresh_token_expiry = Date.now() + apiResult['response'].expires_in * 0.8 * 1000;
        return credentials.access_token;
    } else {
        return credentials.access_token;
    }
}

async function _callPixivApi(url, token) {
    const cache = caches.default;
    const cacheKey = new Request(new URL(url), {
        method: "GET",
        headers: {
            'Referer': 'http://spapi.pixiv.net',
            'User-Agent': 'PixivIOSApp/5.6.0',
        }
    })
    const cacheKeyForRequest = new Request(new URL(url), {
        method: "GET",
        headers: {
            'Referer': 'http://spapi.pixiv.net',
            'User-Agent': 'PixivIOSApp/5.6.0',
            'Authorization': 'Bearer ' + token
        }
    })

    let cachedResponse = await cache.match(cacheKey)

    if (!cachedResponse) {
        const res = await fetch(cacheKeyForRequest)
        cachedResponse = new Response(res.body, res)
        cachedResponse.headers.set('Cache-Control', 'max-age=3600');
        await cache.put(cacheKey, cachedResponse.clone())
    }
    return cachedResponse.json();
}

async function _getImage(url) {
    const cache = caches.default;
    const cacheKey = new Request(new URL(url), {
        method: "GET",
        headers: {
            'Referer': 'http://www.pixiv.net/',
            'User-Agent': 'Cloudflare Workers',
        }
    })

    let cachedResponse = await cache.match(cacheKey)

    if (!cachedResponse) {
        const res = await fetch(cacheKey)
        cachedResponse = new Response(res.body, res)
        await cache.put(cacheKey, cachedResponse.clone())
    }

    return cachedResponse;
}

async function handleRequest(request) {
    const checkRequest = _checkRequest(request);
    if (checkRequest.is_valid === false) {
        return new Response('404 Not Found', {
            status: 404
        })
    } else if (checkRequest.is_manga === false) { // Normal mode
        const token = await _getToken();
        // Using reverse proxy because pixiv is blocking some IP from cloudflare/google cloud.
        const pixivApi = await _callPixivApi(`https://public-api.secure.pixiv.net/v1/works/${checkRequest.pixiv_id}.json?image_sizes=large`, token);

        if (pixivApi['status'] !== "success") return new Response('這個作品可能已被刪除，或無法取得。', {
            status: 404
        }); // Not found
        if (pixivApi['response'][0]['is_manga']) return new Response('這個作品ID中有' + pixivApi['response'][0]['page_count'] + '張圖片，需要指定頁數才能正確顯示。', {
            status: 404
        }); // This Pixiv ID is manga mode, must to specify which page.

        let image = await _getImage(pixivApi['response'][0]['image_urls'].large);
        image = new Response(image.body, image);
        image.headers.set('X-Origin-URL', pixivApi['response'][0]['image_urls'].large);
        image.headers.set('X-Access-Token-TS', credentials.refresh_token_expiry);
        image.headers.set('Content-Disposition', 'inline; filename="' + _parseFilenameFromUrl(pixivApi['response'][0]['image_urls'].large) + '"');
        image.headers.delete('Via');
        return image;
    } else if (checkRequest.is_manga === true) { // Manga mode
        if (checkRequest.pixiv_page < 0) return new Response('頁數不得為0。', {
            status: 404
        }); // Specified page is 0.

        const token = await _getToken();
        const pixivApi = await _callPixivApi(`https://public-api.secure.pixiv.net/v1/works/${checkRequest.pixiv_id}.json?image_sizes=large`, token);

        if (pixivApi['status'] !== "success") return new Response('這個作品可能已被刪除，或無法取得。', {
            status: 404
        }); // Not found
        if (!pixivApi['response'][0]['is_manga']) return new Response('這個作品ID中有只有一張圖片，不需要指定是第幾張圖片。', {
            status: 404
        }); // This Pixiv ID is Normal mode but the page is specified.
        if (checkRequest.pixiv_page + 1 > pixivApi['response'][0]['page_count'] || checkRequest.pixiv_page < 0) return new Response('這個作品ID中有' + pixivApi['response'][0]['page_count'] + '張圖片，您指定的頁數已超過這個作品ID中的頁數。', {
            status: 404
        }); // The specified page is more than total pages of this ID.

        let image = await _getImage(pixivApi['response'][0]['metadata']['pages'][checkRequest.pixiv_page]['image_urls'].large);
        image = new Response(image.body, image);
        image.headers.set('X-Origin-URL', pixivApi['response'][0]['metadata']['pages'][checkRequest.pixiv_page]['image_urls'].large);
        image.headers.set('X-Access-Token-TS', credentials.refresh_token_expiry);
        image.headers.set('Content-Disposition', 'inline; filename="' + _parseFilenameFromUrl(pixivApi['response'][0]['metadata']['pages'][checkRequest.pixiv_page]['image_urls'].large) + '"');
        image.headers.delete('Via');
        return image;
    }
}