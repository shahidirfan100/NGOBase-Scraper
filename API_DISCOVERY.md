# NGOBase API and source discovery

## Result

NGOBase does not expose a usable JSON endpoint for NGO listing or detail records. The verified production source is the public server-rendered listing route requested directly over HTTP. The actor warms one Patchright Chrome session to clear the Cloudflare managed challenge, transfers the live browser cookies and headers to a shared `impit` client for fast direct requests, and parses responses with Cheerio.

This decision follows the approved fallback to direct HTTP plus HTML parsing after the API-only option was tested and rejected. Direct HTTP only works after a real browser has obtained the Cloudflare clearance cookie, so the browser warm-up is part of the verified request flow.

## Discovery evidence

| Candidate                                | Result                                                          | Decision                                             |
| ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| `/api/ngos`                              | Laravel JSON 404                                                | Rejected                                             |
| `/api/ngos/list`                         | Laravel JSON 404                                                | Rejected                                             |
| `/api/v1/ngos`                           | Laravel JSON 404                                                | Rejected                                             |
| `/api/v1/ngo/{id}`                       | Laravel JSON 404                                                | Rejected                                             |
| `/api/ngo/{id}`                          | Laravel JSON 404                                                | Rejected                                             |
| `/api/agencies/{id}`                     | Laravel JSON 404                                                | Rejected                                             |
| `/ngos/list_all_ngos`                    | HTTP 200, HTML, paginated                                       | Selected for all-record mode                         |
| `/list_searched_ngos_v?search={keyword}` | HTTP 200, HTML                                                  | Selected for keyword mode                            |
| `/filter_redirect`                       | HTTP form response that resolves to canonical filtered HTML URL | Selected for country, state, city, work-area filters |
| `/profile/{id}`                          | HTTP 200, HTML detail page                                      | Not required for list output                         |

## Verified fields

Listing cards use `.ngo_listing_div` and expose:

- NGO profile URL and numeric profile ID
- Name
- Logo URL
- Public website URL
- Facebook URL when published
- LinkedIn URL when published
- City and country
- Work area and sub-work area pairs
- Brief introduction

Missing values are omitted from dataset items rather than emitted as `null`.

## Pagination and filters

- General listing pagination uses `?page=N`.
- Keyword search uses `search` on `/list_searched_ngos_v`.
- Country, state, city, work-area, and sub-work-area filters are resolved through the site's filter form and then requested through the resulting canonical URL.
- Sorting routes use `name_a_to_z` and `year_new_to_old`.

## Anti-blocking notes

NGOBase serves a Cloudflare **managed challenge** (`cf-mitigated: challenge`,
`cType: 'managed'`) on the listing routes. A real browser must solve it; no plain
HTTP client can clear it on its own.

- The actor starts one Patchright real Chrome persistent context using `channel: chrome`, `headless: false`, and `noViewport: true`.
- The browser client is auto-healing: it retries transient navigation errors
  (`ERR_CONNECTION_RESET`, `ERR_ABORTED`, and similar), tolerates
  `page.content()` races while the challenge is navigating, and reloads up to
  three times inside a 60-second window until verified NGOBase content appears.
- Warm-up is mandatory and rotates the connection for up to three attempts.
  Empty challenge HTML is not accepted as success; only verified NGOBase content
  ends the warm-up.
- Verified cloud behavior: the Cloudflare challenge needs its own sub-resources
  (`challenges.cloudflare.com`, `brunhild.challenges.cloudflare.com`). **Apify
  Proxy fails these with `ERR_TUNNEL_CONNECTION_FAILED` and HTTP `401`, so the
  challenge never resolves through Apify Proxy** (datacenter and residential
  groups both failed). A direct connection from the Actor container clears the
  challenge on the first attempt. This is why the default is now
  `proxyConfiguration: { "useApifyProxy": false }`.
- Auto-healing proxy handling: if a proxy is configured, the actor tries it
  first, then automatically falls back to a direct connection and logs a
  warning. The proxy is never retried after the fallback succeeds.
- After the challenge resolves, the actor captures the live navigation request
  headers (user agent, `accept`, `accept-language`, `sec-ch-ua`, and other
  browser values) and the browser cookies, then transfers them to one shared
  `impit` client that uses the **same connection** (proxy or direct).
- Verified: once the browser holds a valid `cf_clearance` cookie, impit with the
  browser's exact user agent and cookies returns `HTTP 200` with NGO content on
  `chrome`, `chrome131`, `chrome151`, and `firefox144`.
- Impit is the fast path. If impit is challenged, the actor reuses the already
  warmed Patchright session for filter resolution and listing requests; it never
  launches a second browser.
- Baseline impit-only behavior against the listing route (no browser clearance):
  `chrome`, `chrome124`-`chrome151`, `firefox*`, and `okhttp*` returned the
  Cloudflare `403` challenge; legacy `chrome100`-`chrome116` and `ios18` failed
  the TLS handshake. This is why impit is only used after browser clearance.
- A custom unblocking proxy can be supplied through `proxyConfiguration.proxyUrls`.
  It must allow `CONNECT` to `challenges.cloudflare.com`, otherwise the direct
  fallback is used.
- Cloudflare response headers can be multiline; they are sanitized before use.
- CSRF and session cookies are carried for filter-resolution requests.
