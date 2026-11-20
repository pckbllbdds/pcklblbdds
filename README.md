# Pickleball Buddies Qatar — Match Center

This is the GitHub-ready Cloudflare Pages version of the Match Center. It follows the dashboard-based Cloudflare setup used for Pantheon Tools: D1 is created and initialized in the Cloudflare dashboard, and Pages Functions receive the database through a dashboard binding. Node.js and Wrangler are not required for the deployment flow in this README.

## What changed from the supplied HTML

- The old browser-only `localStorage` persistence has been removed.
- Shared match data is loaded from and saved to Cloudflare D1 through Pages Functions.
- The public match board refreshes from D1 every 10 seconds.
- The Organizer and Players tabs require one shared organizer password.
- Writes include a revision number. If another organizer saves first, the later save is rejected and the browser loads the latest shared state instead of silently overwriting it.
- The existing match generation, player management, leaderboard, court status and match scoring logic is retained.
- The header now shows only the Organizer action; the redundant Player view button has been removed because the public match board is the default landing view.
- A Facebook Page widget has been added to the public sidebar, with a direct Facebook link as a fallback if Meta blocks the embedded timeline.
- The interface has been refined for phones: the header actions and navigation use consistent touch-friendly layouts, court cards reflow into a grid, player and leaderboard tables scroll within their own containers, and score-entry and organizer controls stack cleanly on narrow screens. The wider desktop layout is retained.

## Files

```text
index.html
schema.sql
functions/
  api/
    auth.js
    state.js
```

The app expects a D1 binding named `DB` (`env.DB` in the Pages Functions). The existing app state is stored as one JSON document in the D1 table `app_state`; this preserves the current app state model and match logic instead of requiring a rewrite into separate player and match tables. The revision check helps prevent silent concurrent overwrites, but this is designed for one organizer making changes at a time, not heavy simultaneous multi-organizer editing.

## 1. Put the project in GitHub

1. Create a new GitHub repository, for example `pickleball-buddies-qatar`.
2. Upload the contents of this project folder to the repository root. `index.html`, `schema.sql`, and the `functions/` directory must be at the top level.
3. Commit the files to the `main` branch.

Do not upload `.dev.vars`, `.env`, passwords or other secrets. The `.gitignore` excludes local secret files.

## 2. Create the Cloudflare D1 database

1. Open the Cloudflare dashboard and select your account.
2. Open **D1 SQL Database** (in some dashboard layouts, find it under **Storage & Databases → D1**).
3. Choose **Create Database**.
4. Name it `pickleball-buddies-qatar` and create it.
5. Keep this tab open; you will use this database when configuring the Pages binding.

## 3. Initialize the database in the D1 SQL Console

This is the dashboard-based equivalent of the SQL setup used for Pantheon Tools. No terminal, Node.js, Wrangler login, or migration command is needed.

1. Open the newly created `pickleball-buddies-qatar` database.
2. Select its **Console** or **SQL Console** tab.
3. In the GitHub repository, open the root-level `schema.sql` file.
4. Copy the entire contents of `schema.sql`.
5. Return to the D1 Console, paste the SQL into the query editor, and select **Execute**.
6. Confirm Cloudflare reports that the statements completed successfully.
7. To verify the table and initial row were created, execute:

   ```sql
   SELECT id, revision, updated_at, state_json FROM app_state;
   ```

   You should see one row with `id` 1, `revision` 1, and an initial state containing empty `players` and `matches` arrays.

The script uses `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE`, so running this exact initialization script again will not erase an existing session. Do not delete the table or replace its data to troubleshoot a later deployment issue.

## 4. Connect the GitHub repository to Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git**.
2. Authorize the Cloudflare GitHub app if prompted and select the `pickleball-buddies-qatar` repository.
3. Choose `main` as the production branch.
4. Set Framework preset to **None**.
5. Leave the Build command blank.
6. Set the Build output directory to `./` and use the repository root as the root directory.
7. Save and deploy the project.

Cloudflare Pages Git integration will deploy future commits pushed to the production branch automatically. The `functions/` folder must remain at the repository root so Pages detects the API functions. Do not use dashboard drag-and-drop Direct Upload for this project because it contains Pages Functions.

## 5. Bind the D1 database to Pages

1. Open **Workers & Pages** and select the Pages project created in Step 4.
2. Open **Settings → Bindings**.
3. Select **Add binding → D1 database**.
4. Set the Variable name to exactly `DB` (uppercase).
5. Select the D1 database `pickleball-buddies-qatar`.
6. Save the binding.
7. Redeploy the Pages project so the new binding is available to the Functions.

The binding name must be `DB`. The API code uses `env.DB`; a different binding name will make the database appear disconnected.

## 6. Set the organizer password

The public match board is readable by visitors, but the Organizer and Players tabs require the shared organizer password.

1. Open the Pages project in Cloudflare.
2. Go to **Settings → Variables and Secrets**.
3. Under the **Production** environment, add a secret named `ADMIN_PASSWORD`.
4. Enter a strong, unique password and save it as an encrypted secret.
5. Redeploy the Pages project so the secret is available to the Functions.

Do not put the password in GitHub, `index.html`, or any other public file. Give it only to trusted organizers.

## 7. Check the deployment

Open the deployed `*.pages.dev` URL.

- The status strip near the top should say that the shared database is connected.
- The public view should load even when no players have been added yet.
- Click **Manage session** or **Players** and enter the organizer password.
- Add a test player, then open the site in another browser/device. The public view should show the updated player/match data after the next refresh cycle (within about 10 seconds).

If the status strip reports a D1 problem, verify that the D1 binding is named `DB`, that it points to `pickleball-buddies-qatar`, and that the `schema.sql` statements were successfully executed in that database's SQL Console. If writes are disabled, verify that the Production secret `ADMIN_PASSWORD` exists and redeploy.

## Important notes

- The public API intentionally allows read access. Do not store private or sensitive personal information in player names or match records.
- The organizer password is a shared password, not individual accounts or role-based access. Anyone who knows it can manage the roster, results and reset the session.
- This version stores the entire app state as one JSON document. A revision check protects against silent concurrent overwrites, but simultaneous edits by multiple organizers may cause one save to be rejected. The affected browser will load the newest data and ask the organizer to re-apply the change.
- D1 starts with a clean session. Data previously stored by the old browser-only version is not automatically uploaded to the new database.
