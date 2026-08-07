# Setting up 3DNYC

This guide takes you from nothing to a working, shareable 3DNYC link. Everything is done by clicking in a web browser. There is no terminal, no code, and nothing to install on your computer.

**Time required: about 20 minutes.** Most of it is waiting for the deployment to finish.

## What you will have when you are done

| | |
|---|---|
| A web address | A link you can open on any laptop or send to a colleague |
| A live map | 3D Midtown and Midtown South, ready to light up |
| A working importer | Drag the weekly availability sheet in, review the matches, commit |
| Photo uploads | Space photos, if you complete the optional storage step |
| Ongoing cost | Roughly $10 to $20 a month |

## Before you start

You need three free accounts. Sign up for each with the same work email so they are easy to find later.

| Account | What it does | Sign up at |
|---|---|---|
| GitHub | Stores the code | github.com |
| Vercel | Runs the website | vercel.com |
| Neon | Stores the data | neon.tech |

All three have free tiers that are enough to get started. Neon and Vercel will eventually cost a small amount as the data grows. See the cost note at the end.

You also need the 3DNYC code to exist in a GitHub repository that your GitHub account can see. If someone else set it up, ask them to add you as a collaborator on the repository before you begin.

---

## Step 1 — Create the database (Neon)

The database holds the buildings, spaces, tenants, and landlord notes.

1. Go to **neon.tech** and click **Sign up**. Choosing "Continue with GitHub" is the fastest route and links the two accounts.
2. Once you are in the console, click **New Project**.
3. Give the project a name. `3dnyc` is fine.
4. Choose a region. Pick **AWS US East (N. Virginia)** — it is the closest option to New York, which keeps the app fast.
5. Leave the Postgres version at the default.
6. Click **Create project**.

Neon takes a few seconds and then shows you a connection string.

### Copy both connection strings

A connection string is the long line of text the app uses to reach the database. Neon gives you **two versions of it** and 3DNYC needs both.

1. In the Neon console, open your project and find the **Connection Details** panel on the dashboard. If you do not see it, look for **Connect** in the top right.
2. There is a toggle or checkbox labelled **Pooled connection** (on some screens it reads "Connection pooling"). It sits just under the connection string itself.
3. With the toggle **on**, copy the string. This is the **pooled** string. Paste it somewhere safe — an open Notes window is fine for the next ten minutes.
4. Turn the toggle **off**. The string changes. Copy this one too. This is the **direct** or **unpooled** string.

The two strings look almost identical. The pooled one contains `-pooler` in the middle of the host name. That is the only visible difference, so label them clearly when you paste them.

> **The password is shown once.** The connection string contains the database password, and Neon will not show it to you again after you leave the page. If you lose it, you can generate a new one from **Roles** in the Neon console, but then you have to update both values in Vercel. Copy both strings before you close the tab.

---

## Step 2 — Put the code on Vercel

Vercel is what turns the code into a live website.

1. Go to **vercel.com** and log in. If you are signing up now, choose **Continue with GitHub** so Vercel can see your repositories.
2. Click **Add New** in the top right, then **Project**.
3. Under **Import Git Repository**, find the 3DNY repository in the list and click **Import**.
   - If it is not listed, click **Adjust GitHub App Permissions** (or **Configure GitHub App**) and grant Vercel access to that repository, then come back to this screen.
4. Vercel now shows a configuration screen with a large **Deploy** button.

**Do not click Deploy yet.** Expand the **Environment Variables** section on this same screen first. If you deploy before filling those in, the site will come up but will not be able to reach the database. That is fixable, but it wastes a deployment cycle.

Leave the Framework Preset, Root Directory, and Build Command exactly as Vercel detected them.

---

## Step 3 — Fill in the environment variables

An environment variable is a named setting that the app reads when it starts. You add them as name-and-value pairs in the **Environment Variables** section of the same Vercel screen.

For each row in the table below, type the name into the **Key** box, paste the value into the **Value** box, and click **Add**.

| Name | What it is | Where to get it | Required? |
|---|---|---|---|
| `DATABASE_URL` | The everyday connection to the database | Neon → Connection Details → toggle **on** → copy (the one containing `-pooler`) | Required |
| `DATABASE_URL_UNPOOLED` | A direct connection, used when the app creates or changes tables | Neon → Connection Details → toggle **off** → copy | Required |
| `BLOB_READ_WRITE_TOKEN` | Permission to store space photos | Do not type this. Vercel adds it for you in Step 4 | Optional |
| `NEXT_PUBLIC_PMTILES_URL` | The file of 3D building shapes | Only exists once someone has built and uploaded the tile file. Leave blank for now | Optional |
| `NEXT_PUBLIC_BASEMAP_URL` | The streets and labels drawn underneath the buildings | Same as above. Leave blank for now | Optional |
| `NEXT_PUBLIC_MAP_CENTER` | Where the map opens | Type it in exactly as shown below | Optional |

The value for the last one is:

```
-73.98,40.75
```

That is longitude and latitude, and it centres the map between Midtown and Midtown South. If you leave it out the app uses the same point by default.

### About the optional ones

**The app works without every optional variable above.** Nothing is blocked. Specifically:

| Left blank | What you lose | What still works |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Uploading photos to a space | Everything else, including all imported spec data |
| `NEXT_PUBLIC_PMTILES_URL` | Extruded 3D building shapes and floor bands | Buildings still appear as points and markers; every profile, filter, comparison, and radius search works |
| `NEXT_PUBLIC_BASEMAP_URL` | Detailed streets and labels under the map | The map still renders on a plain background |
| `NEXT_PUBLIC_MAP_CENTER` | Nothing — a default is built in | Everything |

Do not delay a demo waiting for the two tile files. Get the database connected, import a sheet, and add the tiles later. Adding a variable later takes about a minute and one redeploy.

---

## Step 4 — Turn on photo storage

Skip this step if you do not need to attach photos to spaces yet. You can come back to it at any time.

1. In Vercel, open your project and click the **Storage** tab.
2. Click **Create Database** (some screens say **Create** or **Connect Store**).
3. Choose **Blob**.
4. Give it a name, such as `3dnyc-photos`, and click **Create**.
5. When Vercel asks which project to connect it to, choose your 3DNYC project and click **Connect**.

That is all. Vercel writes the `BLOB_READ_WRITE_TOKEN` variable into your project automatically. **You do not copy or paste anything by hand.** If you go back to the Environment Variables screen you will see it appear on its own.

If you add Blob storage after the site is already live, Vercel will prompt you to redeploy so the new token takes effect. Say yes.

---

## Step 5 — Deploy

1. Back on the project screen, click **Deploy**.
2. Wait. A build log scrolls past. It usually takes 90 seconds to two minutes.
3. When it finishes you get a congratulations screen with a screenshot of the site and a link above it, something like `3dny-abc123.vercel.app`.

Click the link. The app opens. It will tell you the database is not set up yet — that is expected, and Step 6 fixes it.

Save that URL. It is the link you will share.

---

## Step 6 — Create the database tables

The database exists but is empty. It has no tables in it yet. The app creates them for you.

1. In your browser, add `/setup` to the end of your app's URL and press Enter. For example: `https://3dny-abc123.vercel.app/setup`
2. The Setup page checks the database connection and reports what it finds.
3. Click **Create database tables**.
4. Wait a few seconds. The page confirms the tables were created.

That is the whole step. There is nothing to run and nothing to paste.

**It is safe to click that button more than once.** The setup routine only creates things that are not already there, so clicking it twice, or after a future update, does not delete or duplicate anything. If you are ever unsure whether it worked, just click it again.

If the page reports a connection error, go back to Vercel → Settings → Environment Variables and check that both database values were pasted in full. A connection string cut off partway through is the most common cause.

---

## Step 7 — Upload your first sheet

1. Open your app URL.
2. Click **Import** in the navigation.
3. Drag the weekly availability CSV onto the drop zone. You do not need to reformat it. The importer expects the sheet exactly as it is produced: market name on row 1, a blank row 2, headers on row 3, data from row 4 down.
4. The app shows a preview and a match summary, along the lines of `30 rows — 27 matched exactly, 2 need review, 1 unmatched`.
5. Work through the **review queue**. For each address the app could not pin down, it shows you the row and a map. Click the correct building. That choice is remembered permanently, so the same address never asks again.
6. Click **Commit**.
7. Go to the map. The buildings from the sheet are now highlighted.

### Doing a dry run first

Two real sample sheets ship with the app, one for Midtown and one for Midtown South. The Import page offers them as a one-click **load sample** option, so you can practise the whole flow — including the review queue — before touching live data. The samples deliberately include the awkward cases: an address with no street number, hyphenated address ranges, and a duplicated row.

Two more templates are included for the data you write by hand rather than receive: a landlord sheet and a tenant sheet. See [docs/LANDLORD-SHEET.md](docs/LANDLORD-SHEET.md) for how to fill in the landlord one.

The exact rules for every column of the weekly sheet are in [docs/CSV-SPEC.md](docs/CSV-SPEC.md).

---

## Step 8 — Put the real Cresa logo in place

The app ships with a built-in Cresa mark so it never looks unbranded. To use the exact
artwork from the company website instead:

1. Save the logo file from the Cresa website to your computer. SVG is best because it stays
   sharp at every size; PNG, JPG and WEBP also work, up to 4 MB.
2. Open `/setup` and scroll to **Company logo**.
3. Drag the file onto the drop zone, or click **choose a file**.
4. Two live previews appear — the real navigation bar and the real footer. Use the five
   sliders to get it sitting right:
   - **Scale** — how large the artwork is inside the space reserved for it.
   - **Height** — how much vertical space the logo takes in the navigation bar.
   - **Horizontal offset** and **Vertical offset** — nudge it left/right and up/down when
     the artwork has uneven padding baked into the file.
   - **Footer scale** — the footer lockup is smaller; this shrinks or grows it on top of the
     main scale.
5. Click **Save logo**. Everyone sees the change on their next page load.

**Reset to default** puts the built-in mark back at any time. Nothing is deleted.

This step needs photo storage (Step 4) to be switched on, because the file has to live
somewhere. If it is not set up yet, the page says so in plain English and points you back.

---

## Step 9 — Fill in the landlords

Every building that arrives with a sheet gets a landlord record created for it automatically,
seeded from the owner name on the city's tax record. You never start from a blank list.

1. Open **Landlords** in the navigation.
2. Records seeded from city records carry a yellow **Needs review** strip. The name on a deed
   is usually a holding company rather than the name a broker would use, so:
   - Click **Edit** to replace it with the operating landlord's name, then write the insights,
     amenities and portfolio numbers.
   - Or click **Confirm** if the seeded name is already correct.
3. If a building has no landlord yet — for example after a sheet that arrived before this
   feature existed — click **Pull owners from city records** and the app fills the gaps.

What to write in each field is covered in [docs/LANDLORD-SHEET.md](docs/LANDLORD-SHEET.md).
This is the one part of the app that no data feed can fill in for you, and it is the part
that makes the compare view worth showing to a client.

---

## Sharing the link

**The app has no login.** Anyone who has the URL can open it, see every space, and edit the data. There is no password screen and no account list.

This is deliberate. The prototype exists to be opened in front of senior people in a meeting, and a login prompt at that moment is friction with no benefit.

The consequence, stated just as plainly: **do not put confidential material in this app until a login is added.** In particular, keep out landlord breakeven figures, operating expenses, negotiated deal terms, and anything about a client that would embarrass you if it were forwarded. Availability data drawn from a market sheet that already circulates widely is fine. Anything you would mark confidential in an email is not.

The deployment URL is long and random, and the app asks search engines not to index it. That is obscurity, not security. Treat the link the way you would treat an unlisted document link: fine to send to a colleague, not fine as a home for sensitive numbers.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Database is not set up" message on every page | The tables have not been created yet | Open `/setup` and click **Create database tables** (Step 6) |
| "Database is not set up" even after clicking the button | `DATABASE_URL` is missing, truncated, or has the wrong password | Vercel → Settings → Environment Variables. Check both database values are complete and end in the same way Neon showed them. Redeploy after editing |
| Setup page reports a connection timeout | The Neon project is suspended or was deleted | Open the Neon console. A sleeping project wakes on its own within a few seconds; if the project is gone, redo Step 1 and repaste both strings |
| Map is blank, grey, or plain-coloured, but the sidebar lists buildings | `NEXT_PUBLIC_BASEMAP_URL` and `NEXT_PUBLIC_PMTILES_URL` are not set | Expected until the tile files are built and uploaded. Everything except the 3D view still works. Add the two values later and redeploy |
| Map is blank **and** the sidebar is empty | No data has been imported yet | Go to Import and upload a sheet, or load a sample |
| Buildings appear but do not extrude into 3D | `NEXT_PUBLIC_PMTILES_URL` is missing or points at a file that is not there | Check the value in Vercel. It must be a full `https://` URL that opens in a browser |
| Photo upload fails or the upload button is missing | Blob storage has not been connected | Do Step 4, then redeploy when Vercel prompts |
| Photo upload fails after connecting Blob | The project was not redeployed after the token was added | Vercel → Deployments → the three-dot menu on the most recent one → **Redeploy** |
| Import finds no matches at all | The file is not the weekly sheet, or the headers were edited | The parser looks for a row containing both `Address` and `Floor`. Confirm the header row is intact and that no columns were renamed. See docs/CSV-SPEC.md |
| Import says "Missing expected column(s)" | Someone renamed or removed a column upstream | Restore the original column names. Note that `Occupany` really is spelled that way in the source sheet and must stay that way |
| A handful of rows land in the review queue every week | Normal on the first two or three imports | Pick the right building once per address. The queue shrinks to near zero because every choice is remembered |
| One address never matches no matter what | The address has no street number, e.g. `One Soho Sq` | Use the map picker in the review queue to select the building by hand. It is permanent |
| Deployment fails to build | Usually a code change that has not been tested, not a settings problem | Vercel → Deployments → click the failed one → read the last red lines of the log. The previous successful deployment stays live, so the site does not go down |
| Deployment succeeds but the site shows an error page | An environment variable is present but malformed | Check for a stray space, a line break, or quotation marks pasted around a value. Values should have no surrounding quotes |
| Changes to an environment variable seem to do nothing | Variables are read at deploy time | Redeploy after any variable change |

---

## Cost

| Line | Typical |
|---|---|
| Vercel | Free tier is workable; Pro is about $20/month per member if you need it |
| Neon | $0 to start, roughly $5 to $19/month as data grows |
| Vercel Blob (photos) | $1 to $3/month |
| Geocoding, building footprints, basemap | Free |

---

## Glossary

| Term | Meaning |
|---|---|
| **Environment variable** | A named setting the app reads when it starts, such as the database address. Stored in Vercel, never in the code, so passwords do not end up in the repository |
| **Deployment** | One published version of the website. Every change creates a new one. Old deployments stay reachable, so you can roll back to a working version in two clicks |
| **Connection string** | The single line of text that tells the app where the database is and how to log into it. It contains a password, so treat it like one |
| **BIN** | Building Identification Number. New York City's official ID for a physical building. 3DNYC matches every address to a BIN, which is why the right tower highlights rather than a neighbour |
| **PMTiles** | A single-file format holding map data — building shapes, streets, labels. One file is uploaded once and the map reads the parts of it it needs. No map subscription and no API key |
| **Blob storage** | A place to keep uploaded files, in this case space photos. The database stores the link to each photo; the photo itself lives in Blob |
