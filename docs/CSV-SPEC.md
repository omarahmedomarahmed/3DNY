# CSV specification — the weekly availability sheet

This is the exact contract between the "Space Added This Week" sheet and 3DNYC.

**The sheet does not have to change.** The format described here is the format the leasing team already produces, quirks included. This document tells you what the importer does with each column, and what happens when a value is unusual.

Reference implementation: `src/lib/csv-parser.ts`. Real fixtures: `data/samples/space-added-midtown.csv` and `data/samples/space-added-midtown-south.csv`.

---

## 1. File layout

| Row | Content | What the importer does |
|---|---|---|
| 1 | Market label — `Midtown`, `Midtown South` | Stored as `imports.market_label` |
| 2 | Blank | Skipped |
| 3 | Header | Used to locate every column by name |
| 4 and below | Data | One row per available space |

The importer does not hard-code row 3. It scans the first twelve rows for the first row that contains a cell reading `Address` **and** a cell reading `Floor` (case-insensitive), and treats that as the header. The market label is the first non-empty value in column A above that row.

Consequences:

| Situation | Result |
|---|---|
| Someone adds an extra title row at the top | Still works. The header is found by content |
| The blank row 2 is removed | Still works |
| The market label row is missing | Still works. `market_label` is null |
| No row contains both `Address` and `Floor` in the first twelve rows | The import is refused with: *"Could not find a header row containing 'Address' and 'Floor'. This does not look like a Space Added sheet."* Nothing is written to the database |

Trailing empty columns (the sheets end with several stray commas per line) are ignored. Fully blank data rows are skipped. A row with no address is skipped.

---

## 2. Required columns

If any of these are missing from the header row, the import reports `Missing expected column(s): …` and does not proceed.

`Address` · `Date Added` · `Floor` · `SF` · `Asking Rent` · `Space Use` · `Type` · `Sub-LL` · `Occupany` · `Term` · `Leasing Company` · `Agent` · `Agent email` · `Class` · `Submarket Cluster`

Two further columns are read when present and ignored when absent: `Submarket Notes` and `Notes`.

The `Email Sent` column in the source sheets is read by nothing. It can stay.

Header names are matched after trimming whitespace, so ` Asking Rent ` and `Asking Rent` are the same column. They are **not** matched case-insensitively and not matched loosely — `Asking rent` or `Sq Ft` will not be found. If a duplicate header name appears, the leftmost one wins.

---

## 3. Column by column

### Address

| | |
|---|---|
| Becomes | `address_display`, `building_name` |
| Rule | Split on a **spaced hyphen** (` - `). Text before it is the address, text after it is the building name |

Splitting only on ` - ` and not on a bare `-` is deliberate: it keeps hyphenated address ranges intact.

| Input | Address | Building name |
|---|---|---|
| `145 W 30th Street` | `145 W 30th Street` | none |
| `60 E 42nd Street - One Grand Central Place` | `60 E 42nd Street` | `One Grand Central Place` |
| `100 Park Avenue - The Emporis Building` | `100 Park Avenue` | `The Emporis Building` |
| `22-30 Little W 12th Street` | `22-30 Little W 12th Street` | none |
| `24-32 Union Sq E` | `24-32 Union Sq E` | none |
| `One Soho Sq` | `One Soho Sq` | none — **and** the row is flagged |

An address containing no digit at all gets the warning *"Address has no street number — needs a manual building match"* and goes to the review queue, where you click the building on the map once. That choice is stored permanently in `address_aliases` and the address resolves instantly on every future import.

### Date Added

| | |
|---|---|
| Becomes | `date_added` |
| Accepts | `MM/DD/YYYY`, `M/D/YYYY`, `MM-DD-YYYY`, two-digit years (assumed 20xx) |
| Output | ISO `YYYY-MM-DD` |
| Anything else | `null`. The row still imports; it just cannot be filtered by recency |

`06/13/2025` → `2025-06-13`. Note this is US month-first ordering. A day-first date such as `13/06/2025` is rejected as a date (month 13) and stored as null rather than silently misread.

### Floor

| | |
|---|---|
| Becomes | `floor_label` (verbatim), `floor_portion`, `floor_number` |
| Portion | Starts with `Partial` → `partial`. Everything else → `entire` |
| Number | First number in the string, ignoring an ordinal suffix |

| Input | Portion | Number |
|---|---|---|
| `Entire 8th` | entire | 8 |
| `Partial 45th` | partial | 45 |
| `Entire 2nd` | entire | 2 |
| `Ground` | entire | 1 |
| `Penthouse` | entire | −1 |
| `Mezzanine` | entire | 0 |
| `Cellar` | entire | −2 |
| `Entire` (no number) | entire | `null` + warning |

If no number can be read, the row imports with the warning *"Could not read a floor number from …"*. It appears on the building profile but gets no floor band on the tower, because there is nothing to place vertically.

The original text is always kept in `floor_label` and is what the UI displays. `floor_number` exists for filtering and for the band geometry.

### SF

| | |
|---|---|
| Becomes | `sf` |
| Rule | Strip everything except digits and a decimal point, then round |

| Input | Output |
|---|---|
| `"8,323"` | `8323` |
| `"50,891"` | `50891` |
| `4500` | `4500` |
| `~5,000` | `5000` |
| blank, `TBD`, `0`, negative | `null` + warning *"Missing or unreadable square footage"* |

A null SF does not block the import. The space shows as size unknown and is excluded from SF range filters.

### Asking Rent

| | |
|---|---|
| Becomes | `asking_rent_psf` **or** `asking_rent_withheld` |
| Rule | A usable positive number becomes the rent. Anything else sets the withheld flag and leaves the rent null |

| Input | `asking_rent_psf` | `asking_rent_withheld` |
|---|---|---|
| `" $ 60.00 "` | `60` | false |
| `" $ 118.00 "` | `118` | false |
| `" Withheld "` | `null` | **true** |
| `Upon Request` | `null` | **true** |
| `Negotiable` | `null` | **true** |
| `N/A`, `TBD` | `null` | **true** |
| blank | `null` | **true** |
| `$0` | `null` | **true** |

There is no third state. A rent is either a number or explicitly withheld — the app never shows a space as "$0" or as having an unknown-but-not-withheld rent. Withheld spaces are included in rent-range filters only when "include withheld" is on.

### Space Use

Stored verbatim as `space_use`. Values seen in the samples: `Office`, `Off/Ret`, `Off/Med`. No validation — a new value simply becomes a new filter option.

### Type

| | |
|---|---|
| Becomes | `lease_type` |
| Rule | Begins with `sub` → `sublet`. Begins with `direct` → `direct`. Anything else → `null` |

Case-insensitive. `Sublet`, `sub-lease`, and `Sublease` all resolve to `sublet`.

### Sub-LL

Stored verbatim as `sub_landlord`. Blank in every row of both samples. Used when a sublet has a sublandlord worth naming.

### Occupany *(spelled that way on purpose)*

| | |
|---|---|
| Becomes | `occupancy_raw` (verbatim) and `available_from` (a date) |

**The header is misspelled in the source sheet — one `c` short of "Occupancy" — and the parser matches that misspelling.** This is not a bug in either place. The sheet is taken as-is, so the parser looks for `Occupany` first. It falls back to the correctly spelled `Occupancy` if it finds that instead, so a future corrected sheet keeps working. Do not "fix" the header on the sheet to help; both spellings are handled.

| Input | `available_from` |
|---|---|
| `Vacant` | today's date |
| `Immediate` | today's date |
| `30 Days` | today + 30 days |
| `60 Days` | today + 60 days |
| `Sep 2025` | `2025-09-01` |
| `Jul 2026` | `2026-07-01` |
| `Feb 2026` | `2026-02-01` |
| blank or unrecognised | `null` |

A month with no day resolves to the **first** of the month, since that is the earliest the space could be taken.

The original text is always kept in `occupancy_raw` and is what the space detail shows, so `Vacant` still reads as `Vacant` rather than as a date.

### Term

| | |
|---|---|
| Becomes | `term_raw` (verbatim) and `term_expires` (a date) |
| Rule | Only a phrase of the form `thru/through/until/to <Month> <Year>` produces a date |

| Input | `term_expires` |
|---|---|
| `Thru Mar 2033` | `2033-03-31` |
| `Thru Dec 2028` | `2028-12-31` |
| `Thru Feb 2030` | `2030-02-28` |
| `Negotiable` | `null` |
| `5 - 10 Years` | `null` |
| `1 - 10 Years` | `null` |
| blank | `null` |

A month with no day resolves to the **last** day of the month, correctly handling February and leap years, because that is when the lease actually ends.

Term lengths with no fixed end date stay null rather than having a date invented for them. They still display as written, and they are simply absent from expiration-window filters.

### Leasing Company

Stored verbatim. Note that the source sheets truncate several of these mid-word — `Sage Realty Corpo`, `Aurora Capital Associat`, `Rudder Property Gro`, `Adams & Company R`. The importer does not attempt to repair them. They are corrected two ways: by editing the space in-app, and by listing the truncated form as an alias on the landlord record so the two link up. See [LANDLORD-SHEET.md](LANDLORD-SHEET.md).

### Agent

Stored verbatim as `agent_name`.

### Agent email

| | |
|---|---|
| Becomes | `agent_email` and `agent_email_suspect` |
| Rule | The value is always kept. A flag marks it as probably truncated |

Several emails in the source sheets are cut off. The importer never drops them, because a truncated address is still enough for a person to work out the right one. It flags them instead, so nobody sends mail to a bad address from the app.

An email is flagged suspect when:

| Condition | Example from the samples |
|---|---|
| No `@` at all | — |
| Domain contains no dot | `ethan.silverstein@cushwak` |
| Domain ends in a dot | `michaelh@kaufmanorganization.` |
| Top-level domain is 1 character | — |
| Top-level domain is `co`, `ne`, or `or` | `Ron.LoRusso@cushwake.co` |

The last rule catches `.com`, `.net`, and `.org` clipped one character short — the same sheet carries `harry.blair@cushwake.com` in full, which is why `cushwake.co` is treated as damaged rather than as a Colombian domain. A genuine `.co` address will be flagged and needs a manual confirmation in the edit drawer. That is the deliberate trade: a false flag costs one click, a bounced email in front of a client costs more.

Surrounding double quotes are stripped, so `"harry.blair@cushwake.com"` imports clean.

### Class

| | |
|---|---|
| Becomes | `class` |
| Accepts | `A`, `B`, `C`, any case |
| Anything else | `null` |

### Submarket Cluster and Submarket Notes — read this one carefully

**The two column labels do not describe their contents.** In the sheets as produced:

| Header on the sheet | What the cells actually hold | Where it lands |
|---|---|---|
| `Submarket Cluster` | The **market**: `Midtown`, `Midtown South` | `submarket` |
| `Submarket Notes` | The **neighbourhood cluster**: `Gramercy Park`, `Grand Central`, `Plaza District`, `Hudson Square`, `Penn Plaza/Garment`, `Chelsea`, `Times Square`, `Columbus Circle`, `Murray Hill` | `submarket_cluster` |

The parser maps by what the cells contain, not by the header wording. So the value from the column headed `Submarket Cluster` becomes the building's **submarket**, and the value from `Submarket Notes` becomes its **submarket cluster**. In the app, "Chelsea" and "Grand Central" are what you filter on, and they arrive from the column labelled Notes.

This looks wrong every time you read it. It is correct. Do not swap it without also changing the sheet.

`Submarket Notes` is optional. If it is absent, `submarket_cluster` is null and neighbourhood filtering is unavailable for those rows.

### Notes

Stored verbatim, free text, optional column. Blank throughout both samples.

---

## 4. A worked example

Take row 5 of `space-added-midtown.csv`:

```
60 E 42nd Street - One Grand Central Place,06/13/2025,Partial 45th,"5,055", $ 60.00 ,Office,Sublet,,Vacant,Thru Mar 2033,JLL,Sofia Bruno,Sofia.Bruno@jll.com,B,Midtown,Grand Central,,
```

It parses to:

| Field | Value | From |
|---|---|---|
| `addressRaw` | `60 E 42nd Street - One Grand Central Place` | verbatim |
| `addressDisplay` | `60 E 42nd Street` | split on ` - ` |
| `buildingName` | `One Grand Central Place` | split on ` - ` |
| `dateAdded` | `2025-06-13` | `06/13/2025` |
| `floorLabel` | `Partial 45th` | verbatim |
| `floorPortion` | `partial` | leading word |
| `floorNumber` | `45` | first number |
| `sf` | `5055` | commas stripped |
| `askingRentPsf` | `60` | `$` and spaces stripped |
| `askingRentWithheld` | `false` | a number was found |
| `spaceUse` | `Office` | verbatim |
| `leaseType` | `sublet` | `Sublet` |
| `subLandlord` | `null` | blank cell |
| `occupancyRaw` | `Vacant` | verbatim |
| `availableFrom` | today's date | `Vacant` |
| `termRaw` | `Thru Mar 2033` | verbatim |
| `termExpires` | `2033-03-31` | last day of March 2033 |
| `leasingCompany` | `JLL` | verbatim |
| `agentName` | `Sofia Bruno` | verbatim |
| `agentEmail` | `Sofia.Bruno@jll.com` | verbatim |
| `agentEmailSuspect` | `false` | `.com` is intact |
| `buildingClass` | `B` | verbatim |
| `submarket` | `Midtown` | from the `Submarket Cluster` column |
| `submarketCluster` | `Grand Central` | from the `Submarket Notes` column |
| `notes` | `null` | blank |
| `warnings` | none | |

Contrast with row 22 of the same file, which produces one warning:

```
535 Madison Avenue - The Art of American Building,06/17/2025,Entire 31st,"14,765", Withheld ,Office,Sublet,,30 Days,Thru Dec 2028,Cushman & Wakefield,Ethan Silverstein,ethan.silverstein@cushwak,A,Midtown,Plaza District,,
```

| Field | Value |
|---|---|
| `askingRentPsf` / `askingRentWithheld` | `null` / `true` |
| `availableFrom` | today + 30 days |
| `termExpires` | `2028-12-31` |
| `agentEmail` | `ethan.silverstein@cushwak` — kept |
| `agentEmailSuspect` | `true` |
| `warnings` | `Agent email looks truncated: ethan.silverstein@cushwak` |

---

## 5. Deduplication

Within a single file, two rows collapse into one when **all four** of these match:

`address` (after the name is split off, case-insensitive) · `floor label` (case-insensitive) · `SF` · `date added`

The first occurrence is kept and later ones are counted. The import summary reports the number as `duplicatesRemoved`.

The Midtown South sample contains a real instance: `118 W 22nd Street, Entire 12th, 8,250, 06/18/2025` appears on two consecutive rows and imports as one space.

Note what is **not** deduplicated. These are separate spaces and all import:

| Case | Why it survives |
|---|---|
| `509 Fifth Avenue` floors 3 through 12 | Different floor labels — ten genuine listings |
| `24-32 Union Sq E` floors 4, 5, 6 | Different floors and different SF |
| `540 Madison Avenue` Entire 15th and Entire 33rd, both 6,950 SF | Different floors |
| The same floor listed twice with different SF | Different SF — treated as a correction to review, not a duplicate |

---

## 6. Re-importing

You import a sheet every week. Most of it repeats last week's. Nothing duplicates.

The database enforces a natural key on `(building_id, floor_label, SF, date_added)`. Re-importing the same building, floor, size, and date **updates** the existing row rather than inserting a second one. Corrections made upstream — a changed rent, a fixed agent email — flow through on the next import.

This means:

| You do | Result |
|---|---|
| Import the same file twice | Identical data. No duplicates. Safe |
| Import a corrected version of last week's file | The changed fields update in place |
| Import next week's file, listing the same space again on a **new** date added | A second row, because `date_added` differs. That is intentional — it is how the history of a listing is kept |

Spaces that were present for a market and are absent from a newer sheet for that same market are marked `is_active = false`. **They are not deleted.** They drop off the map and out of the default filters, but the record survives, so you can still answer "what was available in June" three months later.

Edits you make in the app to fields the sheet does not carry — photos, notes you typed, a corrected building match — are not touched by a re-import.

---

## 7. Quirks, summarised

| Quirk | Status |
|---|---|
| `Occupany` is misspelled in the source header | Matched as written. `Occupancy` also accepted |
| `Submarket Cluster` holds the market; `Submarket Notes` holds the cluster | Mapped by content, not by the label. Deliberate |
| Several agent emails are truncated | Kept and flagged, never dropped |
| Several leasing company names are truncated | Kept as-is. Resolved through landlord aliases |
| `Asking Rent` has padding spaces and a `$` | Stripped |
| SF is quoted because of the thousands comma | Handled by the CSV reader |
| Trailing empty columns on every line | Ignored |
| Row 1 market label, row 2 blank | Expected, and located by content rather than by row number |
| Duplicate row in the Midtown South sample | Collapsed, and counted in the summary |
