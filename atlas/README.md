# BrandMark Atlas: Kenya's Total Cost compass

Compare eBay, AliExpress, Jumia, Jiji, Kilimall and local supermarkets at a glance.
Imports show the estimated full landed cost (shipping, duty, levies, VAT). Local stores show the shelf price.

| Folder | What it is |
| --- | --- |
| `github-pages/atlas/` | The website, static files only, for `brandmarkenya.com/atlas/` |
| `github-pages/tools/`, `github-pages/.github/` | Optional: automatic refresh of rates and your Google Sheet listings |
| `cloudflare-api/` | The live search service (`functions/api/search.js`), using Cloudflare Workers AI |

The two parts are independent. The website works on its own. Live search is an optional extra that switches on when you give the website the address of the search service.

---

## Part 1. Put Atlas on brandmarkenya.com/atlas/ (GitHub Pages, 5 minutes)

1. Open your `brandmar` repository on GitHub.
2. Upload the **`atlas`** folder (the folder itself, not its contents) to the top level of the repository, next to your `blog` and `advertise` folders. You should end up with `atlas/index.html`.
3. Commit. Wait a minute, then open `https://brandmarkenya.com/atlas/`.
4. Add a link to `/atlas/` in your main site's menu.

Every path inside `atlas/` is relative (`./config.json`, `./listings.json`, `./assets/...`), so it works under `/atlas/` and would work under any other folder name. There is no build step and no function.

### Where to change things
- `atlas/config.json`: rates, stores, contact details, legal details, page settings.
- `atlas/listings.json`: the listings (see "Real listings" below).
- `atlas/forms.json`: the contact and contribution forms.
- Legal pages (`terms`, `privacy`, `disclaimer`, `notices`) are starting templates. Have an advocate review them. Details are filled from `config.json` under `legal`.

### Make the contact forms send
GitHub Pages has no server, so the forms use Web3Forms (free). Get a key at <https://web3forms.com> using `info@brandmarkenya.com`, then put it in `atlas/config.json` at `forms.web3forms_key`. Until you do, the forms say sending is off and give the email address. They never pretend a message was sent.

### Real listings (important before you announce it)
The 34 listings that come with the pack are **samples**. They are marked "Illustrative price" on the page and are not real offers. Replace them with listings you have checked, or the site will mislead people. Two ways:
- Edit `atlas/listings.json` by hand, or
- Keep them in a Google Sheet (start from `github-pages/tools/listings-template.csv`), publish the sheet as CSV, and let the refresh job copy it in. For this: copy `github-pages/tools/update-data.mjs` to `tools/atlas/update-data.mjs` in your repo, copy `github-pages/.github/workflows/atlas-refresh.yml` to `.github/workflows/atlas-refresh.yml`, and add a repository variable `SHEET_CSV_URL` (Settings > Secrets and variables > Actions > Variables). It also refreshes exchange rates every 6 hours.

Sheet columns: `id, name, category, origin, store, price, currency, unit, weight_kg, length_cm, width_cm, height_cm, seller, source_url, verified, checked_on, launched_on, rating, group, notes`.
- `store` is one of `ebay, aliexpress, other, jumia, jiji, kilimall, naivas, carrefour, quickmart` (add more in `config.json` under `stores`).
- Overseas items: `origin` is `US, CN, AE, GB, IN, DE or TR`, and weight and size are required so shipping can be estimated.
- Kenyan stores: `origin` is `KE`, price in `KES`, weight and size are left empty. Nothing is added to the price.
- Mark a row `verified = yes` only with a `source_url` and `checked_on` date. Unverified rows show "Illustrative price".

### How the prices work
- **Imports** (eBay, AliExpress, other overseas sellers): item price + freight (billed weight, minimum, fuel, handling) + insurance if chosen, then duty by category, Import Declaration Fee, Railway Development Levy and 16% VAT. Rates are in `config.json`.
- **Local stores** (Jumia, Jiji, Kilimall, supermarkets): the shelf price in KES. It already includes VAT and duty, so Atlas adds nothing. Delivery fees vary by store.
- Duty rates are indicative. Sources disagree on the Import Declaration Fee (2%, 2.5% and 3.5% appear for different periods), and the file uses 3.5% with a visible note. Confirm with KRA or a clearing agent before you rely on it.

---

## Part 2. Live search with Cloudflare Workers AI (optional, 15 minutes)

`cloudflare-api/functions/api/search.js` takes a search word, reads the public search pages of Jumia, Jiji and Kilimall, and asks Workers AI (`@cf/meta/llama-3.1-8b-instruct`) to list the products it finds. It then **checks every answer against the page text** and throws away anything the page does not contain, so the model cannot invent a listing, price or link. Good answers are cached for an hour.

### Install
1. Put the `cloudflare-api` folder in its own GitHub repository (or add `search.js` under `functions/api/` in an existing Cloudflare Pages project).
2. Cloudflare dashboard > **Workers & Pages > Create > Pages > Connect to Git**. Build command: none. Output directory: `public`.
3. Project **Settings > Bindings > Add > Workers AI**, variable name **`AI`**. Redeploy.
4. Optional variables: `ALLOWED_ORIGINS` (default allows brandmarkenya.com, www and atlas), `CACHE_SECONDS` (default 3600), `SCRAPE_DISABLED=1` (emergency off switch).
5. Test: open `https://<your-project>.pages.dev/api/search?q=thermal+printer`.
6. Switch it on in the website: in `atlas/config.json` set `"site": { "live_search_url": "https://<your-project>.pages.dev/api/search" }`. A "Live search" section appears on the page. Leave it empty to keep it hidden.

### What it returns
`{ ok, q, fetched_at, results: [{ store, title, price_kes, url }], stores: { jumia: { status, count, message }, ... } }`
`status` per store is `ok`, `empty`, `blocked`, `needs_browser`, `ai_failed` or `error`. The website shows these honestly.

### Read this before you switch it on
- **Terms of use.** I did not check each store's current terms, and shops commonly forbid automated reading. Check Jumia, Jiji and Kilimall's terms and robots.txt, or ask them for permission or a partner feed. Their affiliate programmes or official data feeds are the safer long-term route. The function identifies itself honestly (`BrandmarkAtlasBot`) and does not try to disguise itself, cache hits avoid repeat requests, and it limits each visitor to 20 searches an hour.
- **It may return nothing.** Stores use bot protection (the function reports `blocked` and does not try to get around it) and some, notably Kilimall, build their results with JavaScript, which this method cannot read (`needs_browser`). Jumia's search page is the most likely to work. I could not test against the live sites from my environment, only with simulated pages and a simulated AI, so expect to adjust after your first real run. If you need Kilimall and Jiji reliably, Cloudflare Browser Rendering is the next step.
- **AI can be wrong.** The checks catch invented text, but the model can still pick the wrong product from the page. Results are labelled "Live · unverified" on the website, and the Disclaimer says so.
- **Cost.** Workers AI has a free daily allowance and a paid rate after that. Check Cloudflare's current limits. Caching keeps the use low.

### Tests included
`node cloudflare-api/test/search.test.mjs` checks that invented listings are dropped, blocked and JavaScript-only stores are reported, cache and rate limit work, and other websites are refused.

---

## Honest limits
- The sample listings are not real prices.
- Freight rates in `config.json` are indicative. Replace them with a forwarder's rate card before quoting anyone.
- Atlas gives estimates, not quotes. The legal pages say so.
