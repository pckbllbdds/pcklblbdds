# Pickleball Buddies Qatar — Match Center

This is the GitHub-ready Cloudflare Pages version of the Match Center.

## What changed from the supplied HTML

- The old browser-only `localStorage` persistence has been removed.
- Shared match data is loaded from and saved to Cloudflare D1 through Pages Functions.
- The public match board refreshes from D1 every 10 seconds.
- The Organizer and Players tabs require one shared organizer password.
- Writes include a revision number. If another organizer saves first, the later save is rejected and the browser loads the latest shared state instead of silently overwriting it.
- The existing match generation, player management, leaderboard, court status and match scoring logic is retained.

## Files

```text
index.html
functions/
  api/
    auth.js
    state.js
migrations/
  0001_initial.sql
wrangler.toml
```

The existing app state is stored as one JSON document in the D1 table `app_state`. This is intentional: it preserves the current app's state model and match logic instead of requiring a full rewrite into separate player and match tables. D1 is still the authoritative SQL-backed store. The optimistic revision check prevents unnoticed last-write-wins conflicts, but this is designed for one organizer making changes at a time, not heavy simultaneous multi-organizer editing.

## 1. Put the project in GitHub

1. Create a new GitHub repository, for example `pickleball-buddies-qatar`.
2. Upload the contents of this project folder to the repository root. `index.html`, `functions/`, `migrations/` and `wrangler.toml` must be at the top level.
3. Commit the files to the `main` branch.

Do not upload `.dev.vars`, `.env`, passwords or other secrets. The `.gitignore` already excludes those files.

## 2. Create the Cloudflare D1 database

You can create the database in the Cloudflare dashboard under **Workers & Pages → D1 SQL Database → Create**. Name it:

```text
pickleball-buddies-qatar
```

Copy the database UUID/ID shown by Cloudflare. Open `wrangler.toml` and replace:

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

with the real database ID. The binding must remain named `DB`, because the Pages Function reads `env.DB`.

Alternatively, from this project folder, authenticate Wrangler once with `npx wrangler login`, then create it using:

```bash
npx wrangler d1 create pickleball-buddies-qatar
```

Copy the returned `database_id` into `wrangler.toml`.

## 3. Apply the database migration

Install Node.js if it is not already installed. Open a terminal in this project folder, authenticate with `npx wrangler login` if you have not done so already, then run:

```bash
npx wrangler d1 migrations apply pickleball-buddies-qatar --remote
```

Confirm the migration when prompted. It creates the `app_state` table and inserts the initial empty session. Run this against the **remote** database, not `--local`.

## 4. Connect the GitHub repository to Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git**.
2. Authorize the Cloudflare GitHub app and select the repository.
3. Choose `main` as the production branch.
4. Use no framework/build command. Set the build output directory to `./` and the root directory to the repository root.
5. Deploy the project.

The included `wrangler.toml` declares the Pages output directory and the D1 binding (`DB`). If the Pages dashboard asks you to configure the D1 binding separately, use variable name `DB` and select the `pickleball-buddies-qatar` database. Do not use a different binding name. Redeploy after changing runtime bindings.

Cloudflare Pages Git integration will deploy future commits pushed to the production branch automatically.

## 5. Set the organizer password

The app allows everyone to view the public board, but only people with the organizer password can open the Organizer and Players tabs or save changes.

Set a strong, unique password as a Cloudflare Pages secret. From the project folder, run:

```bash
npx wrangler pages secret put ADMIN_PASSWORD --project-name pickleball-buddies-qatar
```

Enter the password when Wrangler prompts. Alternatively, in the Cloudflare dashboard open the Pages project and go to **Settings → Variables and Secrets → Add**, create `ADMIN_PASSWORD`, enter the value, and mark it as **Encrypt**.

After setting the secret, redeploy the Pages project. Give the password only to trusted organizers. It is not stored in the repository or browser storage; it remains in memory for the current page session and is sent to the same-origin API over HTTPS when an organizer action is saved.

## 6. Check the deployment

Open the deployed `*.pages.dev` URL.

- The status strip near the top should say that the shared database is connected.
- The public view should load even when no players have been added yet.
- Click **Manage session** or **Players** and enter the organizer password.
- Add a test player, then open the site in another browser/device. The public view should show the updated player/match data after the next refresh cycle (within about 10 seconds).

If the status strip reports a D1 problem, check that the D1 binding is named `DB`, the database ID in `wrangler.toml` is correct, and migration `0001_initial.sql` has been applied to the remote database.

## Important notes

- The public API intentionally allows read access. Do not store private or sensitive personal information in player names or match records.
- The organizer password is a shared password, not individual accounts or role-based access. Anyone who knows it can manage the roster, results and reset the session.
- This version stores the entire app state as one JSON document. A revision check protects against silent concurrent overwrites, but simultaneous edits by multiple organizers may cause one save to be rejected. The affected browser will load the newest data and ask the organizer to re-apply the change.
- D1 starts with a clean session. Data previously stored by the old browser-only version is not automatically uploaded to the new database.
