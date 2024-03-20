# pixivcat-cloudflare-workers

Pixiv.cat on Cloudflare Workers

## Setup

1. (Optional)[Install wrangler](https://github.com/cloudflare/workers-sdk/tree/main/packages/wrangler).

2. [Get your REFRESH_TOKEN](https://gist.github.com/upbit/6edda27cb1644e94183291109b8a5fde).

3. Set your `REFRESH_TOKEN` as encrypted environment variable in Cloudflare Workers.

```text
wrangler secret put REFRESH_TOKEN
```

Alternatively, you can set environment variables in "Settings" tab of your workers project.

4. Update `PIXIV_API_ENDPOINT` and `PIXIV_OAUTH_ENDPOINT` variables in `wrangler.toml`.
You will need to set up two reverse proxy on your own web server, here is an example for nginx:

```text
server {
    listen 443 ssl;

    ssl_certificate /path/to/certificate.pem;
    ssl_certificate_key /path/to/certificate.key;

    server_name oauth.example.com;

    location / {
    proxy_pass https://oauth.secure.pixiv.net;
    proxy_ssl_server_name on;
    proxy_set_header Host oauth.secure.pixiv.net;
}

}
server {
    listen 443 ssl;

    ssl_certificate /path/to/certificate.pem;
    ssl_certificate_key /path/to/certificate.key;

    server_name app-api.example.com;

    location / {
    proxy_pass https://app-api.pixiv.net;
    proxy_ssl_server_name on;
    proxy_set_header Host app-api.pixiv.net;
 }
}
```

Then edit the variables and replace with your url in `wrangler.toml`.

```text
[vars]
PIXIV_API_ENDPOINT = "app-api.example.com"
PIXIV_OAUTH_ENDPOINT = "oauth.example.com"
```

5. Upload the codes to Cloudflare Workers.

```text
wrangler deploy
```

Demo: <https://demo.pixivcat.workers.dev/75034219.jpg>
