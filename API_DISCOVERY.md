# NGOBase API and source discovery

## Result

NGOBase does not expose a usable JSON endpoint for NGO listing or detail records. The verified production source is the public server-rendered listing route requested directly over HTTP. The actor uses `impit` for the HTTP request and Cheerio for parsing the response.

This decision follows the approved fallback to direct HTTP plus HTML parsing after the API-only option was tested and rejected.

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

- The actor starts one Patchright real Chrome persistent context using `channel: chrome`, `headless: false`, and `noViewport: true`.
- It warms the exact keyword URL, or the base filter/bootstrap URL for location-only searches, then transfers the browser cookies into the shared request cookie jar.
- One shared `impit` client with Chrome impersonation uses the same proxy and transferred cookies for the fast direct-request path.
- If Impit receives a confirmed access challenge, the actor reuses the already-warmed Patchright session for filter resolution and listing requests; it does not launch a second browser.
- Tested direct `impit` profiles against the listing route: `chrome`, `chrome151`, `firefox144`, and `okhttp4` all returned Cloudflare `403` challenge HTML; `ios18` failed the TLS handshake.
- Tested the known `/api/*` candidates with Chrome and OkHttp-style requests; they returned challenge HTML and no NGO data.
- Apify Proxy can be supplied through `proxyConfiguration`; the browser and Impit requests share the selected proxy URL for session consistency.
- Direct local requests can receive a Cloudflare access challenge depending on the source IP, so a local 403 does not indicate a parser failure.
- Hosted builds launched Patchright real Chrome under Apify Xvfb and reached NGOBase through the configured proxy, but some Apify Cloud proxy IPs remained blocked after the challenge wait. The implementation waits up to 30 seconds for the challenge to resolve, accepts verified NGOBase content even when the initial navigation status remains `403`, and sanitizes multiline Cloudflare response headers.
- CSRF and session cookies are carried for filter-resolution requests.
