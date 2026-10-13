# NGOBase API and source discovery

## Result

NGOBase does not expose a usable JSON endpoint for NGO listing or detail records. The verified production source is the public server-rendered listing route requested directly over HTTP. The actor parses responses with Cheerio.

Request flow is **direct-first and auto-healing**: the actor tries `impit` direct requests across a rotation of verified browser profiles. It only warms one Patchright Chrome session when every direct profile is challenged, transfers the live browser cookies and headers to the shared `impit` client, and reuses the warmed session if `impit` is challenged again mid-run. This decision follows the approved fallback to direct HTTP plus HTML parsing after the API-only option was tested and rejected.

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

NGOBase serves a Cloudflare **managed challenge** on the listing routes for
flagged clients. Plain HTTP clients are only challenged when the request IP or
fingerprint is flagged; a browser is not always required.

### Verified request order (auto-healing)

1. **Direct `impit` request first.** The actor requests the target URL with one
   shared `impit` client. No browser is launched when the direct request returns
   real NGOBase content.
2. **Profile rotation on challenge.** If a direct request returns the Cloudflare
   challenge page, the actor rotates through the verified `impit` profiles
   (`chrome`, `firefox`, `chrome131`, `okhttp`) before giving up on direct HTTP.
   Rotation also applies if a challenge appears mid-run.
3. **Browser warm-up only as a fallback.** If every direct profile is challenged,
   the actor launches one Patchright real Chrome persistent context
   (`channel: chrome`, `headless: false`, `noViewport: true`), waits for the
   managed challenge, and transfers the browser cookies and navigation headers to
   `impit`. The warmed session is reused directly if `impit` is challenged again.
4. **Bounded recovery.** Browser warm-up is non-fatal: if it cannot clear the
   challenge, the actor reports a clear error instead of crashing, and each
   request uses only bounded retries with `Retry-After` or capped exponential
   backoff.

### Verified impit profile behavior (direct request, live listing route)

Checked against `https://ngobase.org/list_searched_ngos_v`:

| Profiles                                        | Result                          |
| ----------------------------------------------- | ------------------------------- |
| `chrome`, `chrome124`-`chrome151`, `firefox*`, `okhttp*` | HTTP 200 with NGO content |
| `chrome100`-`chrome116`, `ios18`                | TLS handshake failure (excluded) |

The actor therefore only rotates among profiles verified to complete the TLS
handshake: `chrome`, `firefox`, `chrome131`, `okhttp`.

### Cloudflare challenge root cause (why browser warm-up can fail)

Since around July 2026 Cloudflare's interactive challenge loads a subresource
from `brunhild.challenges.cloudflare.com`, which publishes **AAAA (IPv6) records
only and no A record**. On an IPv4-only host (such as the default Actor
container) that name resolves to nothing, so the browser logs
`net::ERR_NAME_NOT_RESOLVED` for `brunhild.challenges.cloudflare.com`, the
challenge widget never loads, and the challenge page spins forever. The
`challenges.cloudflare.com/.../pat/` requests returning `401` are the optional
Private Access Token probe and are expected, not the failure cause.

Because the browser challenge cannot be cleared on an IPv6-only-widget network,
direct HTTP is the primary and most reliable path. The actor must not require a
browser warm-up to start.

### Proxy behavior

- The default is `proxyConfiguration: { "useApifyProxy": false }`.
- **Verified online (Apify cloud):** a no-proxy run succeeded. `chrome` was
  challenged on the datacenter IP, the actor rotated to the `firefox` profile,
  and that profile returned NGO content. Profile rotation is what clears the
  challenge; a browser is not required.
- **Verified online (Apify cloud):** an Apify **residential** proxy run also
  succeeded, returning content on the first profile (`chrome`). Residential
  proxy is a supported optional layer, not a requirement.
- Verified: Apify Proxy cannot `CONNECT` to `challenges.cloudflare.com`
  (`ERR_TUNNEL_CONNECTION_FAILED` / `401`), so it cannot clear the *browser*
  challenge. This does not affect direct requests, which do not need the
  challenge widget.
- If a proxy is configured, the actor tries it first for both direct `impit`
  requests and browser warm-up, then automatically falls back to a direct
  connection and logs a warning. The proxy is never retried after a successful
  fallback.
- A custom unblocking proxy can be supplied through `proxyConfiguration.proxyUrls`.

### Cloudflare and browser warm-up

- `brunhild.challenges.cloudflare.com` publishes AAAA (IPv6) records only. On an
  IPv4-only host the browser challenge widget cannot load, which is why the
  browser is only a fallback and why direct requests are attempted first.

### Other verified details

- Cloudflare response headers can be multiline; they are sanitized before use.
- CSRF and session cookies are carried for filter-resolution requests.
- The browser client captures live navigation request headers (user agent,
  `accept`, `accept-language`, `sec-ch-ua`, and other browser values) and cookies,
  then transfers them to the shared `impit` client on the same connection.
