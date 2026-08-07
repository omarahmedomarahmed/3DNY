# The landlord sheet

Landlord data is the one part of 3DNYC that nobody hands you. The availability sheet arrives weekly on its own; landlord insight has to be written by a person who knows the market.

This document explains the columns, shows a filled-in example, and — the part that actually matters — says what makes an insight worth reading in a meeting.

Template: `data/samples/landlords-template.csv`
Parser: `src/lib/landlord-csv.ts`

You can also type all of this directly into the app on the Landlords screen. The sheet exists so you can write ten landlords in one sitting instead of ten times through a form.

---

## Where this shows up

A landlord record attaches to every building that landlord owns. It then appears in three places:

| Place | What is shown |
|---|---|
| Building profile | A landlord panel: name, portfolio numbers, amenities, and your insights |
| Compare view | A landlord row per column, so two spaces are compared on ownership as well as spec |
| Filters | Nothing yet. Landlord filtering is not in this version |

---

## File format

Plain CSV. Header on row 1, data from row 2. No market label row, no blank row — that layout belongs to the availability sheet only.

`Landlord` is the only required column. Every other column can be blank, and columns can be left out of the file entirely. A sheet with two columns — `Landlord` and `Insights` — is a perfectly valid import.

---

## Columns

| Column | Type | Notes |
|---|---|---|
| `Landlord` | Text, required | The canonical name. Write it in full and correctly: `Sage Realty Corporation`, not `Sage Realty Corpo` |
| `Aliases` | List, `;` separated | Every other way the name appears. See below — this is the column that does the real work |
| `Buildings Owned` | Whole number | Manhattan count, or total. Pick one convention and stay with it |
| `Portfolio SF` | Number | Commas are fine: `3,500,000` and `3500000` both import as 3500000 |
| `Avg Asking Rent` | Number | Dollars per SF per year. `$` and commas are stripped. `62.00` and `$62` are identical |
| `Amenities` | List, `;` separated | Short noun phrases, not sentences |
| `Notable Tenants` | List, `;` separated | Names only |
| `Contact Name` | Text | Your relationship at the landlord, not the listing broker |
| `Contact Email` | Text | Flagged in the import report if it does not look like a complete address |
| `Contact Phone` | Text | Any format |
| `Insights` | Long text | The substance. Markdown is preserved |

Column names are matched loosely — case, spacing, and punctuation are ignored, and a few synonyms are accepted (`Owner` for `Landlord`, `Email` for `Contact Email`). Extra columns are ignored rather than rejected.

### Semicolon-separated cells

`Amenities`, `Notable Tenants`, and `Aliases` hold lists inside one cell. Separate the entries with a **semicolon**, not a comma — a comma would end the cell.

```
Roof terrace;Bike room;Tenant conference center
```

Spaces around the semicolon are trimmed. Empty entries are dropped, so a trailing semicolon is harmless.

### Long text with commas

If any cell contains a comma — which `Insights` almost always will — the whole cell must be wrapped in double quotes. Every spreadsheet does this automatically when you save as CSV. It only matters if you are editing the file in a text editor by hand.

### Aliases are how the data connects

The availability sheet truncates leasing company names mid-word. The samples contain `Sage Realty Corpo`, `Aurora Capital Associat`, `Rudder Property Gro`, and `Adams & Company R`.

The `Aliases` column is what links those fragments to the real landlord record. Write the canonical name in `Landlord`, then list every truncation, abbreviation, and legacy name you have seen in `Aliases`:

```
Sage Realty Corpo;Sage Realty;Sage;Sage Realty Corp
```

Skip this and the landlord panel stays empty on buildings that are obviously theirs. Add an alias once and every past and future import matches.

### Duplicates

Two rows with the same landlord name are not an error. The later row replaces the earlier one and the import report notes it. If you meant them to be different entities, distinguish them in the `Landlord` column.

---

## Worked example

One row, formatted for reading:

| Column | Value |
|---|---|
| `Landlord` | `Sage Realty Corporation` |
| `Aliases` | `Sage Realty Corpo;Sage Realty;Sage` |
| `Buildings Owned` | `9` |
| `Portfolio SF` | `2,400,000` |
| `Avg Asking Rent` | `85.00` |
| `Amenities` | `Amenity floor with lounge and cafe;Prebuilt suites;Fitness center;Conference facilities;Outdoor terraces` |
| `Notable Tenants` | `Vance Kerr Realty;Example Law Partners LLP` |
| `Contact Name` | `Michael Lenchner` |
| `Contact Email` | `mlenchner@sagerealty.com` |
| `Contact Phone` | `212-555-0177` |
| `Insights` | *see below* |

> The prebuilt program is the reason to look here. Prebuilt full floors deliver furnished and cabled, which suits a tenant that has to be in within a quarter. Rents are held at asking on prebuilts; the negotiation happens on term length and the security deposit, not the face rate. Standard package is a 10-year term, and they will go to 7 for the right credit.

As one CSV line:

```
Sage Realty Corporation,Sage Realty Corpo;Sage Realty;Sage,9,2400000,85.00,Amenity floor with lounge and cafe;Prebuilt suites;Fitness center,Vance Kerr Realty;Example Law Partners LLP,Michael Lenchner,mlenchner@sagerealty.com,212-555-0177,"The prebuilt program is the reason to look here. ..."
```

The rows in `data/samples/landlords-template.csv` use landlords that appear in the availability samples — Aurora Capital Associates, The Feil Organization, Sage Realty Corporation — so an import from the template lights up real buildings immediately. **Their insight text is marked EXAMPLE and is invented.** Replace it with what you actually know before showing it to anyone.

---

## What makes an insight useful

The test is simple. **Would a broker say this out loud in a meeting, and would the client lean forward?**

An insight earns its place when it changes what the tenant does next: which building they tour, what they ask for, how much time they leave themselves.

### Useful

| Category | Example |
|---|---|
| **How they decide** | "Family-owned and long-hold. Decisions run through three people and come back the same week." |
| **Where they flex** | "Trades face rent for term length. Will not move on the free-rent period." |
| **How they concede** | "Concessions arrive as TI dollars, not free rent." |
| **Delivery reality** | "Builds full floors on spec, so a sub-10,000 SF tenant can be in with no work letter." |
| **Timing** | "Allow three weeks from LOI to signature. Their outside counsel is slow in August." |
| **Where they are strong** | "Depth in Penn Plaza and the Garment District. Thin above 42nd." |
| **What is actually good about the building** | "The amenity floor is genuinely used, not a rendering. Tour it at 11am." |
| **A warning** | "Elevator modernisation runs through Q2 next year. Two cars down at a time." |

### Noise

| Anti-pattern | Why it fails |
|---|---|
| "A leading owner of premier Manhattan office properties." | Marketing. Says nothing. Everyone claims it |
| "Founded in 1954." | True, irrelevant to a leasing decision |
| "Owns 26 buildings." | Already a column. Do not repeat structured data in prose |
| "Great landlord to work with." | An opinion with no evidence and no action attached |
| "Rents are high." | Relative to what? The rent is already on the space |
| "Heard they might sell the building." | Rumour. If it is worth saying, say what is known and how |

### Practical guidance

| | |
|---|---|
| Length | Three to six sentences. If it runs longer, it belongs in a memo |
| Voice | How you would say it to a colleague. Not a press release |
| Specifics | Numbers, months, names of programmes. "60-day lead time" beats "moves quickly" |
| Hedging | Say what you know and what you are guessing. "As of the Q1 tour" is a useful clause |
| Freshness | Date anything time-sensitive inside the sentence. Nobody reads a timestamp field |
| Confidentiality | See below. This is not optional |

---

## What must not go in this sheet

3DNYC has **no login**. Anyone with the link opens it. Until authentication is added, the following do not go into the landlord sheet or anywhere else in the app:

| Do not include | |
|---|---|
| Breakeven rents and operating expenses | Landlord economics. Explicitly out of scope for this version |
| Debt terms, maturities, or lender names | Same |
| Deal terms from a negotiation you are in | Would embarrass you if forwarded |
| Anything told to you in confidence by the landlord | Same |
| Personal judgements about named individuals | It will be read by that person eventually |

The line to hold: if you would mark it confidential in an email, it does not go in a link anyone can open. Everything in the "Useful" table above passes that test — it is professional knowledge about how a counterparty operates, not their private numbers.

---

## Importing

1. Fill in the template in Excel or Google Sheets.
2. Save or export as CSV.
3. Open the app → **Landlords** → **Import**.
4. Drop the file in. The app reports how many rows were read and lists any problems — a missing name, an email that looks incomplete, a repeated landlord.
5. Confirm.

Re-importing the same sheet updates the existing landlords by name rather than creating duplicates, so the sheet stays the master copy and can be corrected and re-uploaded as often as you like.

Edits made in the app are overwritten by a later import of the same landlord. Pick one place to be authoritative — the sheet or the app — and keep it there.
