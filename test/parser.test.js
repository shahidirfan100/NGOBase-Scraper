import { describe, expect, it } from 'vitest';

import { extractNextPage, extractSortBase, parseNgoListings } from '../src/main.js';

const listingUrl = 'https://ngobase.org/cwa/US/HLT/health-ngos-charities';
const html = `
    <select id="sortSelect" onchange="document.getElementById('sortForm').action = 'https://ngobase.org/cwa/US/HLT/health-ngos-charities' + '/' + this.value">
        <option value="name_a_to_z">Name</option>
    </select>
    <div class="my_border ngo_listing_div">
        <a href="/profile/1">
            <span class="ngo_name"><span itemprop="name">Example NGO</span></span>
        </a>
        <div class="listing_locations">Toronto</div>
        <div class="listing_locations">Canada</div>
        <ul>
            <li class="ngo_listing_work_area_li">
                <span class="work_area">Health</span>
                <span class="sub_work_area">Mental Health</span>
            </li>
        </ul>
    </div>
    <a rel="next" href="?page=2">Next</a>
`;

describe('NGOBase parser', () => {
    it('extracts listing records without null or empty values', () => {
        const [record] = parseNgoListings(html, listingUrl, '2026-09-07T00:00:00.000Z');

        expect(record).toMatchObject({
            id: '1',
            name: 'Example NGO',
            url: 'https://ngobase.org/profile/1',
            city: 'Toronto',
            country: 'Canada',
            work_areas: [{ area: 'Health', sub_area: 'Mental Health' }],
        });
        expect(Object.values(record).every((value) => value !== null && value !== '')).toBe(true);
    });

    it('extracts the sort base from NGOBase inline JavaScript', () => {
        expect(extractSortBase(html)).toBe(listingUrl);
    });

    it('extracts the next page URL', () => {
        expect(extractNextPage(html, listingUrl)).toBe(`${listingUrl}?page=2`);
    });
});
