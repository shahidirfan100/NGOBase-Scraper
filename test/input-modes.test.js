import { describe, expect, it } from 'vitest';

import { applySort, normalizeInput, normalizeSort, parseNumber, prepareTargets } from '../src/main.js';

const bootstrapHtml = `
    <input type="hidden" name="_token" value="test-token">
    <select id="ngo_country"><option value="CA">Canada</option></select>
    <select id="work_area"><option value="HLT">Health</option></select>
`;
const filterHtml = `
    <select id="sortSelect" onchange="document.getElementById('sortForm').action = 'https://ngobase.org/cwa/CA/HLT/health-ngos-charities' + '/' + this.value"></select>
`;

function htmlResponse(html, url) {
    return {
        ok: true,
        status: 200,
        url,
        headers: new Headers({ 'content-type': 'text/html; charset=UTF-8' }),
        text: async () => html,
    };
}

class MockClient {
    requests = [];

    async fetch(url, options = {}) {
        this.requests.push({ url, options });
        const path = new URL(url).pathname;

        if (path === '/ngos/list_all_ngos') return htmlResponse(bootstrapHtml, url);
        if (path === '/getStatesInSelectFilter') {
            return htmlResponse('<body><option value="ON">Ontario</option></body>', url);
        }
        if (path === '/getCitiesInSelectFilter') {
            return htmlResponse('<body><option value="Toronto">Toronto</option></body>', url);
        }
        if (path === '/getSubWorkAreasInSelect') {
            return htmlResponse('<body><option value="HLT.MN">Mental Health</option></body>', url);
        }
        if (path === '/filter_redirect') {
            return htmlResponse(filterHtml, 'https://ngobase.org/cwa/CA/HLT/health-ngos-charities');
        }

        throw new Error(`Unexpected mock URL: ${url}`);
    }
}

describe('NGOBase input modes', () => {
    it('builds a trimmed keyword target without unrelated filters', async () => {
        const client = new MockClient();
        const input = normalizeInput({ keyword: ' UNICEF ', country: '' });
        const [target] = await prepareTargets(client, input, new Map());

        expect(target.url).toBe('https://ngobase.org/list_searched_ngos_v?search=UNICEF');
        expect(client.requests).toHaveLength(0);
    });

    it('resolves country and work-area filters and applies sorting', async () => {
        const client = new MockClient();
        const input = normalizeInput({ country: 'Canada', workArea: 'Health' });
        const [target] = await prepareTargets(client, input, new Map());
        const sortedUrl = applySort(target.url, normalizeSort('name_a_to_z'), target.sortBase);

        expect(target.url).toBe('https://ngobase.org/cwa/CA/HLT/health-ngos-charities');
        expect(sortedUrl).toBe('https://ngobase.org/cwa/CA/HLT/health-ngos-charities/name_a_to_z');
        expect(client.requests.map(({ url }) => new URL(url).pathname)).toEqual([
            '/ngos/list_all_ngos',
            '/filter_redirect',
        ]);
    });

    it('resolves state, city, and sub-work-area combinations', async () => {
        const client = new MockClient();
        const input = normalizeInput({
            country: 'Canada',
            state: 'Ontario',
            city: 'Toronto',
            workArea: 'Health',
            subWorkArea: 'Mental Health',
        });
        const [target] = await prepareTargets(client, input, new Map());
        const filterRequest = client.requests.find(({ url }) => new URL(url).pathname === '/filter_redirect');

        expect(target.url).toBe('https://ngobase.org/cwa/CA/HLT/health-ngos-charities');
        expect(filterRequest.options.body).toContain('ngo_country=CA');
        expect(filterRequest.options.body).toContain('ngo_state=ON');
        expect(filterRequest.options.body).toContain('ngo_city=Toronto');
        expect(filterRequest.options.body).toContain('sub_work_area1=HLT.MN');
    });

    it('preserves user limits and normalizes invalid numeric values safely', () => {
        expect(parseNumber('35', 20)).toBe(35);
        expect(parseNumber('0', 20)).toBe(1);
        expect(parseNumber('invalid', 20)).toBe(20);
        expect(normalizeSort('default')).toBe('');
        expect(normalizeSort('year_new_to_old')).toBe('year_new_to_old');
    });
});
