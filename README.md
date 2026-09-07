## What does NGOBase Scraper do?

NGOBase Scraper collects structured public information about NGOs, charities, and nonprofit organizations listed on [NGOBase](https://ngobase.org). Use a keyword such as `UNICEF`, or location and work-area filters, to build a clean dataset for research, nonprofit discovery, partnership mapping, grant prospecting, and directory analysis.

Each dataset item contains the organization name, NGOBase profile URL, location, published work areas, public website, social links when available, logo, short introduction, and collection metadata. Missing source fields are left out instead of being filled with `null` values.

## Why use NGOBase Scraper?

- **Search NGO and charity listings** by keyword, country, state or province, city, and work area.

- **Collect structured organization data** that is ready for CSV, JSON, Excel, XML, or downstream analysis.
- **Avoid duplicate records** when the same profile appears across multiple pages or targets.
- **Limit collection size** with result and page limits for quick tests or scheduled runs.
- **Connect results to workflows** through Apify datasets, API access, schedules, webhooks, and integrations.

## What data can you extract from NGOBase?

| Field         | Description                                   |
| ------------- | --------------------------------------------- |
| `id`          | NGOBase profile identifier when available     |
| `name`        | NGO, charity, or nonprofit name               |
| `url`         | NGOBase profile URL                           |
| `logo`        | Public organization logo when available       |
| `website`     | Organization website when published           |
| `facebook`    | Facebook page when published                  |
| `linkedin`    | LinkedIn page when published                  |
| `city`        | Organization city                             |
| `country`     | Organization country                          |
| `work_areas`  | Work areas and sub-areas published by NGOBase |
| `description` | Short public organization introduction        |
| `source_url`  | Listing page used for the record              |
| `source`      | Source website name                           |
| `scraped_at`  | UTC collection timestamp                      |

## How to use NGOBase Scraper

1. Open the Actor on Apify.
2. Provide a keyword or filter values.
3. Set the result limit and maximum page count.
4. Choose the result order when supported by the selected listing.
5. Run the Actor.
6. Download the dataset or connect it to your workflow.

Keyword input takes priority over location and work-area filters. When no search value is provided, the Actor starts from the public all-NGOs listing.

## Input Parameters

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |

| `keyword` | String | No | - | Keyword search when no location filter is supplied |
| `country` | String | No | - | Country name or NGOBase country code |
| `state` | String | No | - | State or province, used with `country` |
| `city` | String | No | - | City, used with `country` |
| `workArea` | String | No | - | Work-area name or code such as `Health` or `HLT` |
| `subWorkArea` | String | No | - | Optional sub-work-area name or code |
| `sorting` | String | No | `default` | `default`, `name_a_to_z`, or `year_new_to_old` |
| `resultsWanted` | Integer | No | `20` | Maximum unique records to save |
| `maxPages` | Integer | No | `10` | Maximum pages per target |
| `proxyConfiguration` | Object | No | Apify Proxy | Optional proxy settings |

For a city filter, provide a country as well. The Actor resolves names against NGOBase’s public filter values, so users do not need to know internal location codes.

## Usage Examples

### Keyword search

Collect NGOBase results related to UNICEF:

```json
{
    "keyword": "UNICEF",
    "resultsWanted": 20,
    "maxPages": 3
}
```

### Country and work-area filter

Collect health organizations in Pakistan:

```json
{
    "country": "Pakistan",
    "workArea": "Health",
    "sorting": "name_a_to_z",
    "resultsWanted": 100,
    "maxPages": 10
}
```

### City filter

Collect organizations listed in Toronto:

```json
{
    "country": "Canada",
    "city": "Toronto",
    "resultsWanted": 50,
    "maxPages": 5
}
```

## Sample Output

```json
{
    "id": "207",
    "name": "Shaukat Khanum Memorial Cancer Hospital & Research Centre",
    "url": "https://ngobase.org/profile/207",
    "logo": "https://ngobase.org/images/ngo_logos/PK/Shaukat-Khanum-Memorial-Cancer-Hospital-%26-Research-Centre-ngo.jpg",
    "website": "https://shaukatkhanum.org.pk/",
    "facebook": "https://www.facebook.com/skmch",
    "city": "Lahore",
    "country": "Pakistan",
    "work_areas": [
        {
            "area": "Specific Diseases",
            "sub_area": "Cancer Care"
        }
    ],
    "description": "Shaukat Khanum cancer hospital is a charity dedicated to providing free cancer treatment in Pakistan.",
    "source_url": "https://ngobase.org/ngos/list_all_ngos",
    "source": "ngobase.org",
    "scraped_at": "2026-09-07T00:00:00.000Z"
}
```

## Tips for Best Results

- Start with `resultsWanted: 20` to verify a search before collecting a larger dataset.

- Use `country` together with `city` for the most precise city filter.
- Use `maxPages` as a safety limit for broad country and global searches.
- Enable Apify Proxy for larger or scheduled runs, or when NGOBase returns an access challenge.
- Review the dataset preview before connecting it to a production workflow.
- Public listings can change. Report changed fields or missing pages through the Actor Issues tab.

## Integrations

- **Apify API** - Read dataset items programmatically after a run.
- **Google Sheets** - Export organization records for review and collaboration.
- **Webhooks** - Trigger downstream processing when a run finishes.
- **Make or Zapier** - Send new NGO records into CRM, research, or notification workflows.
- **CSV, Excel, JSON, and XML** - Export the dataset in common analysis formats.

## Frequently Asked Questions

### Can I collect a specific NGOBase country or city?

Yes. Use `country` and `city` together. The Actor resolves public filter names and follows the resulting listing pages.

### Can I search by an organization name?

Yes. Set `keyword` to an organization name, mission term, or other search phrase. Keyword search takes priority over location and work-area filters.

### Can I collect all NGOBase results?

You can set a high `resultsWanted` value and increase `maxPages`, subject to the source listing and run limits. Start with a smaller run to confirm the filter first.

### Why are some fields missing?

The Actor omits fields that NGOBase does not publish for a particular organization. This keeps the dataset free from misleading always-null columns and empty placeholder values.

### Can I export the results?

Yes. Apify datasets support JSON, CSV, Excel, XML, and other export formats.

### Can I schedule the Actor?

Yes. Create an Apify schedule to run a saved input hourly, daily, weekly, or at another interval.

### Is it legal to collect NGOBase data?

Public data collection may be subject to applicable laws, privacy rules, and NGOBase terms. You are responsible for using the data lawfully, respecting access controls, and following the source website's published rules.

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is intended for legitimate collection of publicly available NGO and nonprofit directory data. Users are responsible for complying with NGOBase terms, applicable laws, privacy requirements, and any restrictions attached to the collected data.
