import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Actor, Dataset, log } from 'apify';
import { load } from 'cheerio';
import { Impit } from 'impit';
import { chromium } from 'patchright';

const SOURCE = 'ngobase.org';
const BASE_URL = 'https://ngobase.org/ngos/list_all_ngos';
const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 10;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 10000;
const NAV_MAX_ATTEMPTS = 3;
const CHALLENGE_WAIT_MS = 60000;
const CHALLENGE_MAX_RELOADS = 3;
const BROWSER_WARMUP_ATTEMPTS = 3;
const DIRECT_FALLBACK_ATTEMPTS = 2;
const SORT_VALUES = new Set(['', 'name_a_to_z', 'year_new_to_old']);
const EXCLUDED_IMPIT_HEADERS = new Set([
    'cookie',
    'host',
    'connection',
    'content-length',
    'content-type',
    'accept-encoding',
    'referer',
    'origin',
]);

let browserSession;

function text(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function absoluteUrl(value, baseUrl) {
    if (!value) return undefined;
    try {
        return new URL(value, baseUrl).href;
    } catch {
        return undefined;
    }
}

function addIfPresent(record, key, value) {
    const cleaned = typeof value === 'string' ? text(value) : value;
    if (
        cleaned !== undefined &&
        cleaned !== null &&
        cleaned !== '' &&
        (!Array.isArray(cleaned) || cleaned.length > 0)
    ) {
        Object.assign(record, { [key]: cleaned });
    }
}

function readSocialLinks(card, baseUrl) {
    const links = {};
    card('a[title], a[itemprop="url"]').each((_, element) => {
        const title = text(card(element).attr('title')).toLowerCase();
        const url = absoluteUrl(card(element).attr('href'), baseUrl);
        if (!url) return;

        if (title.includes('facebook') && !links.facebook) links.facebook = url;
        else if (title.includes('linkedin') && !links.linkedin) links.linkedin = url;
        else if (title.includes('website') && !links.website) links.website = url;
    });
    return links;
}

function parseWorkAreas(card) {
    const workAreas = [];
    card('.ngo_listing_work_area_li').each((_, element) => {
        const area = text(card(element).find('.work_area').first().text());
        const subArea = text(card(element).find('.sub_work_area').first().text());
        const workArea = {};
        addIfPresent(workArea, 'area', area);
        addIfPresent(workArea, 'sub_area', subArea);
        if (Object.keys(workArea).length > 0) workAreas.push(workArea);
    });
    return workAreas;
}

export function parseNgoListings(html, pageUrl, scrapedAt = new Date().toISOString()) {
    const $ = load(html);
    const records = [];

    $('.ngo_listing_div').each((_, element) => {
        const card = (selectorOrElement) =>
            typeof selectorOrElement === 'string' ? $(element).find(selectorOrElement) : $(selectorOrElement);
        const profileUrl = absoluteUrl(card('a[href*="/profile/"]').first().attr('href'), pageUrl);
        const name = text(card('.ngo_name [itemprop="name"], .ngo_name a').first().text());
        if (!name && !profileUrl) return;

        const record = {};
        const idMatch = profileUrl?.match(/\/profile\/([^/?#]+)/i);
        const locations = card('.listing_locations')
            .map((__, location) => text(card(location).text()))
            .get()
            .filter(Boolean);
        const workAreas = parseWorkAreas(card);
        const socialLinks = readSocialLinks(card, pageUrl);
        const logoUrl = absoluteUrl(card('img[itemprop="logo"], .listing_logo_img').first().attr('src'), pageUrl);
        const description = text(card('.brief_intro_row .col').first().text());

        addIfPresent(record, 'id', idMatch?.[1]);
        addIfPresent(record, 'name', name);
        addIfPresent(record, 'url', profileUrl);
        addIfPresent(record, 'logo', logoUrl);
        addIfPresent(record, 'website', socialLinks.website);
        addIfPresent(record, 'facebook', socialLinks.facebook);
        addIfPresent(record, 'linkedin', socialLinks.linkedin);
        addIfPresent(record, 'city', locations[0]);
        addIfPresent(record, 'country', locations[1]);
        addIfPresent(record, 'work_areas', workAreas);
        addIfPresent(record, 'description', description);
        addIfPresent(record, 'source_url', pageUrl);
        addIfPresent(record, 'source', SOURCE);
        addIfPresent(record, 'scraped_at', scrapedAt);

        if (record.name || record.url) records.push(record);
    });

    return records;
}

export function extractNextPage(html, pageUrl) {
    const $ = load(html);
    const candidates = [
        $('a[rel="next"]').first().attr('href'),
        $('a')
            .filter((_, element) => /^(?:next|›|»|>)$/i.test(text($(element).text())))
            .first()
            .attr('href'),
    ];

    for (const candidate of candidates) {
        const nextUrl = absoluteUrl(candidate, pageUrl);
        if (nextUrl) return nextUrl;
    }

    return undefined;
}

export function readSelectOptions(html, selector) {
    const $ = load(html);
    return $(selector)
        .find('option')
        .map((_, element) => ({
            value: text($(element).attr('value')),
            label: text($(element).text()),
        }))
        .get()
        .filter((option) => option.value && option.label);
}

export function resolveOption(options, requested, label) {
    const needle = text(requested).toLowerCase();
    if (!needle) return undefined;

    const exactValue = options.find((option) => option.value.toLowerCase() === needle);
    if (exactValue) return exactValue;

    const exactLabel = options.find((option) => option.label.toLowerCase() === needle);
    if (exactLabel) return exactLabel;

    const partialLabel = options.find((option) => option.label.toLowerCase().includes(needle));
    if (partialLabel) return partialLabel;

    throw new Error(`Could not resolve ${label} "${requested}" from NGOBase filter options.`);
}

export function extractSortBase(html) {
    const $ = load(html);
    const onchange = $('#sortSelect').attr('onchange') || '';
    return onchange.match(/action\s*=\s*['"]([^'"]+)['"]/i)?.[1];
}

export function normalizeText(value) {
    return text(value);
}

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

export function parseNumber(value, fallback, minimum = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

function cleanQueryValue(value) {
    return normalizeText(value);
}

export function normalizeInput(input) {
    const normalized = { ...input };
    for (const field of ['keyword', 'country', 'state', 'city', 'workArea', 'subWorkArea', 'sorting']) {
        if (typeof normalized[field] === 'string') normalized[field] = cleanQueryValue(normalized[field]);
    }
    return normalized;
}

function buildKeywordUrl(keyword) {
    const url = new URL('https://ngobase.org/list_searched_ngos_v');
    url.searchParams.set('search', cleanQueryValue(keyword));
    return url.href;
}

function getCookieHeader(cookieJar) {
    return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function seedCookieJar(cookieJar, cookies) {
    for (const cookie of cookies || []) {
        const name = text(cookie?.name);
        const value = cookie?.value;
        if (name && value !== undefined && value !== null) cookieJar.set(name, String(value));
    }
    return cookieJar;
}

function updateCookies(cookieJar, headers) {
    const setCookies =
        typeof headers.getSetCookie === 'function'
            ? headers.getSetCookie()
            : [headers.get('set-cookie')].filter(Boolean);

    for (const cookie of setCookies) {
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        if (separator > 0) cookieJar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
}

function isRetryableError(error) {
    const message = String(error?.message || error).toLowerCase();
    return /abort|connect|econn|network|reset|temporar|timeout|timed out|fetch failed|stream/i.test(message);
}

function retryAfterMilliseconds(response, attempt) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(RETRY_MAX_DELAY_MS, seconds * 1000);
        }

        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) {
            return Math.min(RETRY_MAX_DELAY_MS, Math.max(0, retryAt - Date.now()));
        }
    }

    const exponentialDelay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    return exponentialDelay + Math.floor(Math.random() * 250);
}

async function fetchWithRetry(client, url, options, cookieJar, label) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const headers = new Headers(options.headers || {});
            const cookie = getCookieHeader(cookieJar);
            if (cookie) headers.set('cookie', cookie);

            const response = await client.fetch(url, {
                ...options,
                headers,
                timeout: options.timeout ?? REQUEST_TIMEOUT_MS,
            });
            if (!response || !Number.isInteger(response.status)) {
                throw new Error(`${label}: invalid HTTP response`);
            }

            updateCookies(cookieJar, response.headers);
            if (typeof client.getCookies === 'function') {
                seedCookieJar(cookieJar, await client.getCookies());
            }

            if (response.status === 429 || response.status >= 500) {
                if (attempt === MAX_RETRIES) return response;
                const wait = retryAfterMilliseconds(response, attempt);
                log.warning(`${label}: HTTP ${response.status}; retrying in ${wait}ms (${attempt}/${MAX_RETRIES})`);
                await sleep(wait);
                continue;
            }

            return response;
        } catch (error) {
            if (!isRetryableError(error) || attempt === MAX_RETRIES) throw error;
            const wait = Math.min(
                RETRY_MAX_DELAY_MS,
                RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250),
            );
            log.warning(`${label}: temporary request error; retrying in ${wait}ms (${attempt}/${MAX_RETRIES})`);
            await sleep(wait);
        }
    }

    throw new Error(`Request failed after ${MAX_RETRIES} attempts: ${url}`);
}

async function readHtmlResponse(response, url, label) {
    if (!response || typeof response.text !== 'function') throw new Error(`${label}: invalid response body for ${url}`);
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status} for ${url}`);

    const contentType = response.headers?.get('content-type')?.toLowerCase() || '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(`${label}: unexpected content type for ${url}`);
    }

    let html;
    try {
        html = await response.text();
    } catch (error) {
        throw new Error(`${label}: could not read response body for ${url}: ${error.message}`);
    }
    if (!html.trim()) throw new Error(`${label}: empty HTML response for ${url}`);
    return html;
}

async function fetchHtml(client, url, cookieJar, referer, label) {
    const response = await fetchWithRetry(
        client,
        url,
        {
            method: 'GET',
            headers: {
                ...(referer && { referer }),
            },
        },
        cookieJar,
        label,
    );

    return {
        html: await readHtmlResponse(response, url, label),
        url: response.url || url,
    };
}

async function postForm(client, url, values, cookieJar, referer, label) {
    const body = new URLSearchParams(values).toString();
    const response = await fetchWithRetry(
        client,
        url,
        {
            method: 'POST',
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'content-type': 'application/x-www-form-urlencoded',
                ...(referer && { referer }),
            },
            body,
        },
        cookieJar,
        label,
    );

    return {
        html: await readHtmlResponse(response, url, label),
        url: response.url || url,
    };
}

export function normalizeSort(value) {
    const sort = cleanQueryValue(value).toLowerCase();
    if (sort === 'default' || sort === 'popularity') return '';
    if (!SORT_VALUES.has(sort)) throw new Error(`Unsupported sorting value "${value}".`);
    return sort;
}

export function applySort(url, sort, sortBase) {
    if (!sort) return url;
    if (!sortBase && new URL(url).pathname.includes('/list_searched_ngos_v')) return url;
    const base = sortBase || url;
    const sortedUrl = new URL(base);
    sortedUrl.pathname = `${sortedUrl.pathname.replace(/\/$/, '')}/${sort}`;
    return sortedUrl.href;
}

function getStaticProxyUrl(proxyConfiguration) {
    if (!Actor.isAtHome() && Array.isArray(proxyConfiguration?.proxyUrls) && proxyConfiguration.proxyUrls.length > 0) {
        return proxyConfiguration.proxyUrls[0];
    }
    return undefined;
}

function createProxyUrlProvider(proxyConfigurationObject, staticProxyUrl) {
    if (proxyConfigurationObject) {
        return async () => {
            try {
                return await proxyConfigurationObject.newUrl();
            } catch {
                return staticProxyUrl;
            }
        };
    }
    return async () => staticProxyUrl;
}

function isAccessChallengeError(error) {
    return /HTTP 403|access denied|cloudflare|challenge|just a moment/i.test(String(error?.message || error));
}

function isNavigationError(error) {
    return /ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|ERR_ABORTED|ERR_EMPTY_RESPONSE|frame was detached|Target closed|navigating/i.test(
        String(error?.message || error),
    );
}

async function readPageContent(page) {
    try {
        return await page.content();
    } catch {
        return '';
    }
}

function toImpitHeaders(headers) {
    const result = {};
    for (const [name, value] of Object.entries(headers || {})) {
        const key = String(name).toLowerCase();
        if (EXCLUDED_IMPIT_HEADERS.has(key)) continue;
        if (typeof value !== 'string' || !value.trim()) continue;
        result[name] = value;
    }
    return result;
}

function toPlaywrightProxy(proxyUrl) {
    if (!proxyUrl) return undefined;
    const parsed = new URL(proxyUrl);
    const proxy = {
        server: `${parsed.protocol}//${parsed.host}`,
    };
    if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
    if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
    return proxy;
}

function browserResponse(status, url, headers, body) {
    const safeHeaders = {};
    for (const [name, value] of Object.entries(headers || {})) {
        const cleanValue = String(value)
            .replace(/[\r\n]+/g, ' ')
            .trim();
        if (cleanValue) safeHeaders[name] = cleanValue;
    }

    return {
        status,
        ok: status >= 200 && status < 300,
        url,
        headers: new Headers(safeHeaders),
        text: async () => body,
    };
}

function isChallengeHtml(html) {
    return /just a moment|checking your browser|challenge-platform\/h\/|cf-mitigated|Enable JavaScript and cookies to continue/i.test(
        html,
    );
}

function hasNgoBaseContent(html) {
    return /ngo_listing_div|id=["']ngo_country|name=["']_token/i.test(html);
}

async function createBrowserClient(proxyUrl) {
    const context = await chromium.launchPersistentContext(
        join(tmpdir(), `ngobase-profile-${process.pid}-${Date.now()}`),
        {
            channel: 'chrome',
            headless: false,
            noViewport: true,
            ...(proxyUrl && { proxy: toPlaywrightProxy(proxyUrl) }),
        },
    );
    const page = await context.newPage();
    let capturedHeaders = {};

    page.on('request', (request) => {
        try {
            if (request.isNavigationRequest() && request.resourceType() === 'document') {
                capturedHeaders = { ...request.headers() };
            }
        } catch {
            // Ignore headers that disappear while the request is being inspected.
        }
    });

    page.on('requestfailed', (request) => {
        const failedUrl = request.url();
        if (/challenge-platform|challenges\.cloudflare\.com|__cf/i.test(failedUrl)) {
            log.warning(`Cloudflare request failed: ${request.failure()?.errorText} | ${failedUrl.slice(0, 160)}`);
        }
    });

    page.on('response', (response) => {
        const responseUrl = response.url();
        if (/challenge-platform|challenges\.cloudflare\.com/i.test(responseUrl) && response.status() >= 400) {
            log.warning(`Cloudflare response ${response.status()} | ${responseUrl.slice(0, 160)}`);
        }
    });

    const waitForChallengeResolution = async (timeout) => {
        const deadline = Date.now() + CHALLENGE_WAIT_MS;
        let html = '';
        let reloads = 0;

        while (Date.now() < deadline) {
            await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 10000) }).catch(() => {});
            await page.waitForTimeout(1200);
            html = await readPageContent(page);
            if (hasNgoBaseContent(html)) return html;

            if (reloads < CHALLENGE_MAX_RELOADS) {
                reloads++;
                await page.reload({ waitUntil: 'commit', timeout }).catch(() => {});
            }
        }

        return html;
    };

    const describeChallenge = async () => {
        try {
            const details = await page.evaluate(() => ({
                title: document.title,
                webdriver: Boolean(navigator.webdriver),
                turnstileFrames: document.querySelectorAll(
                    'iframe[src*="challenges.cloudflare.com"], #challenge-stage, #challenge-running, #challenge-form',
                ).length,
                hasChrome: Boolean(window.chrome),
                ua: navigator.userAgent,
            }));
            return `title="${details.title}" webdriver=${details.webdriver} turnstile=${details.turnstileFrames} chrome=${details.hasChrome} ua="${details.ua}"`;
        } catch {
            return 'diagnostics unavailable';
        }
    };

    const client = {
        async fetch(url, options = {}) {
            const method = options.method || 'GET';
            const timeout = options.timeout ?? REQUEST_TIMEOUT_MS;
            const referer = options.headers?.get?.('referer');

            if (method === 'GET') {
                let response;
                for (let attempt = 1; attempt <= NAV_MAX_ATTEMPTS; attempt++) {
                    try {
                        response = await page.goto(url, {
                            waitUntil: 'commit',
                            timeout,
                            ...(referer && { referer }),
                        });
                        break;
                    } catch (error) {
                        if (!isNavigationError(error) || attempt === NAV_MAX_ATTEMPTS) throw error;
                        await sleep(1000 * attempt);
                    }
                }

                const html = await waitForChallengeResolution(timeout);
                const responseHeaders = response?.headers() || { 'content-type': 'text/html; charset=UTF-8' };
                const responseStatus = response?.status();
                let status = responseStatus || 200;
                if (hasNgoBaseContent(html)) status = 200;
                else if (isChallengeHtml(html)) {
                    status = responseStatus || 403;
                    log.warning(`NGOBase challenge unresolved | ${await describeChallenge()}`);
                }
                return browserResponse(status, page.url(), responseHeaders, html);
            }

            const requestHeaders = Object.fromEntries(new Headers(options.headers || {}).entries());
            delete requestHeaders.cookie;
            const result = await page.evaluate(
                async ({ requestUrl, requestMethod, headers, body }) => {
                    const response = await fetch(requestUrl, {
                        method: requestMethod,
                        headers,
                        body,
                        credentials: 'include',
                        redirect: 'follow',
                    });
                    return {
                        status: response.status,
                        url: response.url,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: await response.text(),
                    };
                },
                {
                    requestUrl: url,
                    requestMethod: method,
                    headers: requestHeaders,
                    body: options.body,
                },
            );
            return browserResponse(result.status, result.url || url, result.headers, result.body);
        },
        getCookies: async () => context.cookies('https://ngobase.org'),
        getHeaders: async () => {
            const headers = { ...capturedHeaders };
            if (!headers['user-agent']) {
                headers['user-agent'] = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
            }
            if (!headers['accept-language']) {
                const language = await page.evaluate(() => navigator.language).catch(() => undefined);
                if (language) headers['accept-language'] = `${language},en;q=0.9`;
            }
            return toImpitHeaders(headers);
        },
    };

    return {
        client,
        getCookies: client.getCookies,
        getHeaders: client.getHeaders,
        close: async () => {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
        },
    };
}

async function warmUpBrowser(proxyPlans, warmupUrl, cookieJar) {
    let lastError;

    for (const plan of proxyPlans) {
        for (let attempt = 1; attempt <= plan.attempts; attempt++) {
            const proxyUrl = await plan.provide();
            let session;

            try {
                session = await createBrowserClient(proxyUrl);
            } catch (error) {
                lastError = error;
                log.warning(`Patchright launch failed (${plan.label}, ${attempt}/${plan.attempts}): ${error.message}`);
                continue;
            }

            try {
                const response = await session.client.fetch(warmupUrl, {
                    method: 'GET',
                    headers: new Headers({ accept: 'text/html,application/xhtml+xml' }),
                    timeout: REQUEST_TIMEOUT_MS,
                });
                const html = await response.text().catch(() => '');
                seedCookieJar(cookieJar, await session.getCookies());

                if (hasNgoBaseContent(html)) {
                    const browserHeaders = await session.getHeaders();
                    log.info(
                        `Patchright warm-up completed | ${plan.label} | attempt=${attempt} | cookies=${cookieJar.size}`,
                    );
                    return { session, browserHeaders, proxyUrl };
                }

                lastError = new Error(`${plan.label}: warm-up challenge not resolved (HTTP ${response.status})`);
                log.warning(
                    `Patchright warm-up challenge not resolved (${plan.label}, ${attempt}/${plan.attempts}); rotating session.`,
                );
            } catch (error) {
                lastError = error;
                seedCookieJar(cookieJar, await session.getCookies().catch(() => []));
                log.warning(`Patchright warm-up failed (${plan.label}, ${attempt}/${plan.attempts}): ${error.message}`);
            }

            await session.close().catch(() => {});
        }
    }

    throw new Error(`NGOBase browser warm-up failed after all attempts: ${lastError?.message}`);
}

export async function resolveFilterTarget(client, input, cookieJar, bootstrap) {
    const countryOptions = readSelectOptions(bootstrap.html, '#ngo_country');
    const workAreaOptions = readSelectOptions(bootstrap.html, '#work_area');
    const country = input.country ? resolveOption(countryOptions, input.country, 'country') : undefined;
    const workArea = input.workArea ? resolveOption(workAreaOptions, input.workArea, 'work area') : undefined;

    let state;
    let city;
    if (input.state || input.city) {
        if (!country) throw new Error('The state or city filter requires a country filter.');

        const statesResponse = await postForm(
            client,
            'https://ngobase.org/getStatesInSelectFilter',
            {
                cid: country.value,
                _token: readToken(bootstrap.html),
            },
            cookieJar,
            BASE_URL,
            'Resolve states',
        );
        const states = readSelectOptions(statesResponse.html, 'body');
        state = input.state ? resolveOption(states, input.state, 'state') : undefined;

        if (input.city) {
            const statesToCheck = state ? [state] : states;
            for (const stateOption of statesToCheck) {
                const citiesResponse = await postForm(
                    client,
                    'https://ngobase.org/getCitiesInSelectFilter',
                    {
                        sid: stateOption.value,
                        _token: readToken(bootstrap.html),
                    },
                    cookieJar,
                    BASE_URL,
                    'Resolve cities',
                );
                const cities = readSelectOptions(citiesResponse.html, 'body');
                const found =
                    cities.find((option) => option.value.toLowerCase() === cleanQueryValue(input.city).toLowerCase()) ||
                    cities.find((option) => option.label.toLowerCase() === cleanQueryValue(input.city).toLowerCase()) ||
                    cities.find((option) =>
                        option.label.toLowerCase().includes(cleanQueryValue(input.city).toLowerCase()),
                    );
                if (found) {
                    city = found;
                    state = stateOption;
                    break;
                }
            }
            if (!city) throw new Error(`Could not resolve city "${input.city}" for country "${input.country}".`);
        }
    }

    let subWorkArea;
    if (input.subWorkArea) {
        const workAreaCode = workArea?.value || cleanQueryValue(input.subWorkArea).split('.')[0];
        const subWorkAreasResponse = await postForm(
            client,
            'https://ngobase.org/getSubWorkAreasInSelect',
            {
                wa_id: workAreaCode,
                _token: readToken(bootstrap.html),
            },
            cookieJar,
            BASE_URL,
            'Resolve sub work areas',
        );
        subWorkArea = resolveOption(
            readSelectOptions(subWorkAreasResponse.html, 'body'),
            input.subWorkArea,
            'sub work area',
        );
    }

    const hasFilter = country || state || city || workArea || subWorkArea;
    if (!hasFilter) return undefined;

    const filterResponse = await postForm(
        client,
        'https://ngobase.org/filter_redirect',
        {
            _token: readToken(bootstrap.html),
            ngo_country: country?.value || '',
            ngo_state: state?.value || '',
            ngo_city: city?.value || '',
            work_area: workArea?.value || '',
            sub_work_area1: subWorkArea?.value || '',
        },
        cookieJar,
        BASE_URL,
        'Build NGOBase filter URL',
    );

    return {
        url: filterResponse.url,
        sortBase: extractSortBase(filterResponse.html),
    };
}

function readToken(html) {
    const match = html.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i);
    if (!match) throw new Error('NGOBase CSRF token was not found while resolving filters.');
    return match[1];
}

export async function prepareTargets(client, input, cookieJar) {
    if (input.keyword) {
        return [{ url: buildKeywordUrl(input.keyword), sortBase: undefined }];
    }

    if (input.country || input.state || input.city || input.workArea || input.subWorkArea) {
        const bootstrap = await fetchHtml(client, BASE_URL, cookieJar, undefined, 'Load NGOBase filter options');
        const target = await resolveFilterTarget(client, input, cookieJar, bootstrap);
        return [target];
    }

    return [{ url: BASE_URL, sortBase: undefined }];
}

async function getInput() {
    const actorInput = await Actor.getInput();
    if (actorInput && Object.keys(actorInput).length > 0) return actorInput;

    // Local development only: never inject fixtures into Apify platform runs.
    if (Actor.isAtHome()) return {};

    try {
        const fallback = await readFile(new URL('../INPUT.json', import.meta.url), 'utf8');
        return JSON.parse(fallback);
    } catch {
        return {};
    }
}

async function run() {
    const input = normalizeInput(await getInput());
    const resultsWanted = parseNumber(input.resultsWanted ?? input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = parseNumber(input.maxPages ?? input.max_pages, DEFAULT_MAX_PAGES);
    const sort = normalizeSort(input.sorting ?? input.sort);
    const { proxyConfiguration } = input;
    const proxyConfigurationObject =
        proxyConfiguration && Actor.isAtHome() ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;
    const staticProxyUrl = getStaticProxyUrl(proxyConfiguration);
    const hasConfiguredProxy = Boolean(proxyConfigurationObject) || Boolean(staticProxyUrl);
    const proxyPlans = [];

    if (hasConfiguredProxy) {
        proxyPlans.push({
            label: 'configured proxy',
            provide: createProxyUrlProvider(proxyConfigurationObject, staticProxyUrl),
            attempts: BROWSER_WARMUP_ATTEMPTS,
        });
    }
    proxyPlans.push({
        label: hasConfiguredProxy ? 'direct fallback' : 'direct connection',
        provide: async () => undefined,
        attempts: hasConfiguredProxy ? DIRECT_FALLBACK_ATTEMPTS : BROWSER_WARMUP_ATTEMPTS,
    });

    if (hasConfiguredProxy) {
        log.warning(
            'Configured proxy detected; a direct-connection fallback is enabled if the proxy cannot clear Cloudflare.',
        );
    }

    const cookieJar = new Map();
    const warmupUrl = input.keyword ? buildKeywordUrl(input.keyword) : BASE_URL;

    log.info(`Starting Patchright session warm-up | target=${new URL(warmupUrl).pathname}`);
    const { session, browserHeaders, proxyUrl } = await warmUpBrowser(proxyPlans, warmupUrl, cookieJar);
    browserSession = session;

    const impitClient = new Impit({
        browser: 'chrome',
        ...(proxyUrl && { proxyUrl }),
        ...(Object.keys(browserHeaders).length > 0 && { headers: browserHeaders }),
    });
    let activeClient = impitClient;

    const switchToBrowser = async () => {
        if (activeClient !== browserSession.client) {
            log.warning('NGOBase access challenge detected; reusing the warmed Patchright Chrome session.');
        }
        seedCookieJar(cookieJar, await browserSession.getCookies());
        activeClient = browserSession.client;
        return activeClient;
    };

    let targets;
    try {
        targets = await prepareTargets(activeClient, input, cookieJar);
    } catch (error) {
        if (activeClient !== impitClient || !isAccessChallengeError(error)) throw error;
        await switchToBrowser();
        targets = await prepareTargets(activeClient, input, cookieJar);
    }
    const scrapedAt = new Date().toISOString();
    const seen = new Set();
    let saved = 0;
    let pagesProcessed = 0;

    log.info(`Starting NGOBase run | targets=${targets.length} | results=${resultsWanted} | max_pages=${maxPages}`);

    for (const target of targets) {
        if (saved >= resultsWanted) break;
        let pageUrl = applySort(target.url, sort, target.sortBase);

        for (let pageIndex = 0; pageIndex < maxPages && saved < resultsWanted; pageIndex++) {
            let response;
            try {
                response = await fetchHtml(activeClient, pageUrl, cookieJar, target.url, `Fetch page ${pageIndex + 1}`);
            } catch (error) {
                if (activeClient !== impitClient || !isAccessChallengeError(error)) throw error;
                await switchToBrowser();
                response = await fetchHtml(activeClient, pageUrl, cookieJar, target.url, `Fetch page ${pageIndex + 1}`);
            }
            pagesProcessed++;
            const items = parseNgoListings(response.html, response.url, scrapedAt)
                .filter((item) => {
                    const key = item.url || item.id || `${item.name}-${item.city || ''}-${item.country || ''}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .slice(0, resultsWanted - saved);

            if (items.length > 0) {
                await Dataset.pushData(items);
                saved += items.length;
                log.info(`Saved ${items.length} items | total=${saved}/${resultsWanted} | page=${pageIndex + 1}`);
            }

            const nextPage = extractNextPage(response.html, response.url);
            if (!nextPage || items.length === 0) break;
            pageUrl = nextPage;
        }
    }

    if (saved === 0) throw new Error('NGOBase returned no NGO records for the supplied input.');
    log.info(`Finished NGOBase run | saved=${saved} | pages=${pagesProcessed}`);
}

async function main() {
    await Actor.init();
    let failure;
    try {
        await run();
    } catch (error) {
        failure = error;
    } finally {
        if (browserSession) await browserSession.close().catch(() => {});
    }

    if (failure) {
        log.exception(failure, 'NGOBase run failed');
        await Actor.fail();
    } else {
        await Actor.exit();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
