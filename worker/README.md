# ADMIRALTY proxy setup

This Worker holds the subscription key outside the public GitHub Pages code. It is prepared for the Discovery API; authenticated access must be verified after deployment. It does not change the website's provider yet.

1. In Cloudflare Workers & Pages, create a Worker named `sun-shade-tides` using the Hello World starter.
2. Open Edit code, replace the starter with `index.mjs`, and deploy.
3. In the Worker's Settings > Variables and Secrets, add a **Secret** called `ADMIRALTY_API_KEY`. Paste your ADMIRALTY key into its value and deploy/save the change. Never enter it as a plain-text variable, URL parameter, repository file or chat message.
4. Open the Worker's `/health` URL. It should report `configured: true` without displaying the secret.
5. Share only the public `https://sun-shade-tides.YOUR-SUBDOMAIN.workers.dev` URL so the website integration can be configured and verified.

Routes: `/stations` and `/events?station=STATION_ID`. Use an ID returned by `/stations`; do not assume EasyTide URL IDs are interchangeable. Events use the upstream GMT timestamps unchanged. Errors never forward upstream bodies or the key.

No data is persisted or cached by this Worker; responses include no-store headers because the free Discovery subscription disallows caching. Do not add Cloudflare cache rules for it. The frontend must also avoid storing these responses. Review the subscription's display/attribution terms before enabling it publicly.

CORS allows the existing GitHub Pages origin and the local preview. CORS is not authentication: the public endpoint can consume subscription quota. Monitor usage in ADMIRALTY and Cloudflare; use only free service plans. Do not expose additional arbitrary proxy paths.

CLI alternative from this directory: `npx wrangler deploy`, then `npx wrangler secret put ADMIRALTY_API_KEY` (the command prompts privately for the value).

Run tests from the repository root with `node --test tests/worker.test.mjs`.
