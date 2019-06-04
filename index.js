addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

var cacheStatus = ["HIT", "HIT", "HIT"];

function _checkRequest(request) {
  const url = new URL(request.url);
  if ( /^\/(\d+)-(\d+).(jpg|png|gif)$/.test(url.pathname) ) {
    let result = /^\/(\d+)-(\d+).(jpg|png|gif)$/.exec(url.pathname);
    return {
      is_valid: true,
      is_manga: true,
      pixiv_id: result[1],
      pixiv_page: result[2] - 1
    };
  } else if ( /^\/(\d+)\.(jpg|png|gif)/.test(url.pathname) ) {
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
  return url.substring(url.lastIndexOf('/')+1)
}

async function _getToken() {
  const cache = caches.default;
  
  // Use this API to get fresh Pixiv access token of our account.
  const url = new URL('https://api.pixiv.cat/v1/oauth2-token/public/random');
  const cacheKey = new Request(url, {
    method: "GET"
  })
  
  let cachedResponse = await cache.match(cacheKey)
  
  if (!cachedResponse) {
    const res = await fetch(cacheKey)
    cachedResponse = new Response(res.body, res)
    await cache.put(cacheKey, cachedResponse.clone())
    cacheStatus[0] = "MISS"
  }

  const apiResult = await cachedResponse.json();
  return apiResult['result'].token;
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
    cacheStatus[1] = "MISS"
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
    cacheStatus[2] = "MISS"
  }
  
  return cachedResponse;
}

function _cacheStatusHeaderValue() {
  return cacheStatus[0] + ', ' + cacheStatus[1] + ', ' + cacheStatus[2]
}

async function handleRequest(request) {
  const checkRequest = _checkRequest(request);
  if (checkRequest.is_valid === false) {
    return new Response('404 Not Found', { status: 404 })
  } else if (checkRequest.is_manga === false) { // Normal mode
    const token = await _getToken();
    // Using reverse proxy because pixiv is blocking some IP from cloudflare/google cloud.
    const pixivApi = await _callPixivApi(`https://public-api-secure-pixiv-net.pixiv.cat/v1/works/${checkRequest.pixiv_id}.json?image_sizes=large`, token);

    if (pixivApi['status'] !== "success") return new Response('這個作品可能已被刪除，或無法取得。', { status: 404 }); // Not found
    if (pixivApi['response'][0]['is_manga']) return new Response('這個作品ID中有' + pixivApi['response'][0]['page_count'] + '張圖片，需要指定頁數才能正確顯示。', { status: 404 }); // This Pixiv ID is manga mode, must to specify which page.

    let image = await _getImage(pixivApi['response'][0]['image_urls'].large);
    image = new Response(image.body, image);
    image.headers.set('X-Cache-Status', _cacheStatusHeaderValue());
    image.headers.set('X-Origin-URL', pixivApi['response'][0]['image_urls'].large);
    image.headers.set('Content-Disposition', 'inline; filename="' + _parseFilenameFromUrl(pixivApi['response'][0]['image_urls'].large) + '"');
    image.headers.delete('Via');
    return image;
  } else if (checkRequest.is_manga === true) { // Manga mode
    if (checkRequest.pixiv_page < 0) return new Response('頁數不得為0。', { status: 404 }); // Specified page is 0.

    const token = await _getToken();
    const pixivApi = await _callPixivApi(`https://public-api-secure-pixiv-net.pixiv.cat/v1/works/${checkRequest.pixiv_id}.json?image_sizes=large`, token);

    if (pixivApi['status'] !== "success") return new Response('這個作品可能已被刪除，或無法取得。', { status: 404 }); // Not found
    if (!pixivApi['response'][0]['is_manga']) return new Response('這個作品ID中有只有一張圖片，不需要指定是第幾張圖片。', { status: 404 }); // This Pixiv ID is Normal mode but the page is specified.
    if (checkRequest.pixiv_page + 1 > pixivApi['response'][0]['page_count'] || checkRequest.pixiv_page < 0) return new Response('這個作品ID中有' + pixivApi['response'][0]['page_count'] + '張圖片，您指定的頁數已超過這個作品ID中的頁數。', { status: 404 }); // The specified page is more than total pages of this ID.

    let image = await _getImage(pixivApi['response'][0]['metadata']['pages'][checkRequest.pixiv_page]['image_urls'].large);
    image = new Response(image.body, image);
    image.headers.set('X-Cache-Status', _cacheStatusHeaderValue());
    image.headers.set('X-Origin-URL', pixivApi['response'][0]['metadata']['pages'][checkRequest.pixiv_page]['image_urls'].large);
    image.headers.set('Content-Disposition', 'inline; filename="' + _parseFilenameFromUrl(pixivApi['response'][0]['metadata']['pages'][checkRequest.pixiv_page]['image_urls'].large) + '"');
    image.headers.delete('Via');
    return image;
  }
}

