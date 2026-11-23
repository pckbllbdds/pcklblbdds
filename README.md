# Pickleball Buddies Qatar — Match Center

This is the GitHub-ready Cloudflare Pages version of the Match Center. It follows the dashboard-based Cloudflare setup used for Pantheon Tools: D1 is created and initialized in the Cloudflare dashboard, and Pages Functions receive the database through a dashboard binding. Node.js and Wrangler are not required for the deployment flow in this README.

## What changed from the supplied HTML

- The old browser-only `localStorage` persistence has been removed.
- Shared match data is loaded from and saved to Cloudflare D1 through Pages Functions.
- The public match board refreshes from D1 every 10 seconds.
- The Organizer and Players tabs require one shared organizer password. After a successful sign-in, this browser receives a secure, HttpOnly device session cookie that survives page refreshes for up to one year. Other devices must sign in separately; the Logout button clears the current browser's session.
- Writes include a revision number. If another organizer saves first, the later save is rejected and the browser loads the latest shared state instead of silently overwriting it.
- The existing match generation, player management, leaderboard, court status and match scoring logic is retained.
- Interclub Tournament Mode provides a public, read-only club bracket and an Organizer-only setup/editor. Each club-vs-club bracket tie contains multiple generated doubles games based on the registered players for both clubs; each eligible duo matchup becomes a game. Club tie winners are decided by game wins and advance through a standard seeded 2–16-club single-elimination bracket.
- Tournament fixture editing is stable while open: fixture fields are staged and saved explicitly, the 10-second background refresh pauses while a match editor is open, and score/result saves update only the tournament view while preserving the open editor and bracket scroll position.
- The header now shows only the Organizer action; the redundant Player view button has been removed because the public match board is the default landing view.
- A minimal “Join us on Facebook” text link appears in the public sidebar and opens the club Facebook page.
- The Reset Session action remains separated at the bottom of the Organizer view, away from routine session controls. Its existing confirmation prompt and reset behavior are preserved.
- The interface has been refined for phones: the header actions and navigation use consistent touch-friendly layouts, court cards reflow into a grid, player and leaderboard tables scroll within their own containers, and score-entry and organizer controls stack cleanly on narrow screens. The wider desktop layout is retained.

## Organizer device sign-in

A successful password check creates a browser-specific, signed session cookie. The cookie is `HttpOnly`, `Secure`, and `SameSite=Strict`; it is not exposed to page JavaScript or stored in local storage. Refreshing the page keeps the device signed in. The Logout button calls `DELETE /api/auth` to clear that browser's cookie. Changing the Cloudflare `ADMIN_PASSWORD` invalidates previously issued device cookies. No D1 migration is required for this feature.

## Files

```text
index.html
schema.sql
functions/
  api/
    auth.js
    state.js
  _shared/
    auth.js
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


## Leaderboard update
- Leaderboards include an overall ranking across all skill brackets, individual bracket views, and completed games played alongside wins and losses.


### Match score limits

Completed match scores are restricted to whole numbers: each team may score up to 11 points, and the combined score for one match may not exceed 21 points. This is checked in the organizer interface and again by the Pages state API. No D1 schema migration is required.

### Mobile player search

Public Find a Player search is available as its own top-level tab alongside the Waiting Players list, keeping the Live & Upcoming Match Board compact on mobile. Search results appear only after a name is entered.

### Public navigation update
- The Live & Upcoming tab shows Court Availability first, followed by the Match Board.
- Waiting Players has been moved into the Find a Player tab, alongside the player search, so the live match view stays focused and compact.
- This is a presentation-only update; the existing waiting-list and player-search data/rendering remain unchanged.


### Match status card shades
- Ongoing matches use a soft green shade, Upcoming matches use a soft blue shade, and Recent Results use a subtle neutral sage shade. The status badges follow the same restrained color cues. Existing match data, timing, scoring, and winner/loser styling are unchanged.


### Fixed partner duos, gender formats and Tournament Mode

- Organizer player registration supports Female, Male or Not set, plus an optional fixed partner selection. Existing players can be assigned or unpaired in the Players directory. Pair links are stored reciprocally in the shared D1 state JSON.
- Match generation keeps fixed partners on the same doubles team. Players with an unavailable or busy fixed partner are held out of new match generation until both partners are available. Manual substitutions/removals cannot split a fixed duo.
- The Organizer can select Open, Girls only, Boys only, or Girls vs Boys for normal Open Play. Girls vs Boys means one all-female doubles team against one all-male doubles team.
- Tournament Mode opens a dedicated public Interclub Tournament tab. It is separate from everyday Open Play matchmaking and has its own club rosters, gender format, game generation, scoring and knockout bracket.
- Home-club players are imported from the existing Players directory; all registered players are selected automatically by default, regardless of whether they are marked available for everyday Open Play. Organizers may deselect players who are not entering the event. Organizers register the opposing club names and their players, with skill bracket, gender and optional fixed partner. Unpaired players are automatically paired within their own club, subject to the Beginner skill restriction and selected gender format.
- For each club-vs-club tie, the app creates one doubles game for every compatible matchup of two players from Club A against two players from Club B. Each player is used once in the regular games for that tie; existing fixed duos stay together. If a club has more eligible duos than its opponent, the smaller roster determines the game count and the remaining duo sits out that tie.
- The club with more completed game wins advances. If the regular games finish level, a deciding doubles game is added using the first game's duos. The club-level draw uses standard seeded single-elimination positions for 2–16 clubs, including automatic first-round byes.
- The browser and Pages state API validate roster membership, fixed duos, skill compatibility, gender formats, individual game scores, club-tie totals and bracket progression. No D1 schema migration is required because roster and tournament data are stored in the existing JSON state row.

## Interclub Tournament tab

- Enabling Tournament Mode opens a dedicated public Interclub Tournament tab. Visitors can see the full bracket, all generated individual doubles games, live scores, completed game results, club-tie game tallies and clubs advancing. Only the Organizer can edit the event.
- Organizers can configure the tournament name, select the home-club roster from registered PBB players, and register 2–16 participating clubs including Pickleball Buddies Qatar.
- Each opponent club has its own roster. Register at least two eligible players per club; assign fixed partners where needed or allow automatic pairing. Each compatible duo on one club plays one doubles game against a compatible duo from the other club: four eligible players per club generate two games; eight generate four. If rosters differ in size, the smaller number of eligible duos determines the game count and extra duos sit out that tie.
- The first round's club ties and all their doubles games are generated immediately when the Organizer selects **Generate bracket & all doubles games**. Later-round games are generated as soon as both clubs advance into that tie.
- Every individual doubles game has its own schedule, court, venue, notes, status, live score and final score. The score limit is 11 points maximum per side and 21 combined, with no tied final result.
- The club with more game wins advances. When regular games finish level, a deciding game is created automatically. The bracket winner is displayed as tournament champion.
- Tournament editing pauses the 10-second background refresh while a game editor is open. Saves preserve the current game editor and bracket scroll position; scoring updates refresh only the Tournament view rather than rebuilding the entire app.
- Disabling Tournament Mode hides the tab but preserves its saved roster and bracket. Tournament data is stored in the existing `app_state.state_json` record; no D1 schema migration is required.

### Public interclub tournament bracket

When Tournament Mode is enabled, visitors can open the Interclub Tournament tab without signing in. The public display shows each club-level knockout tie and every doubles game inside it: player names, scheduled details, LIVE NOW status and live score, completed scores, per-club game-win totals, the advancing club and the eventual champion. The public GET endpoint is read-only; organizers alone can register rosters, edit game details and record scores. Updates use the existing 10-second shared-state refresh, which pauses while an Organizer has a game editor open to avoid disrupting active edits.


### Open Play partner rotation

- In normal Open Play matchmaking, two non-fixed players cannot be teammates for more than two consecutive matches. The streak is measured across each player's successive match appearances: if either player appears in a different pairing, the streak is broken.
- The generator evaluates alternate doubles-team splits for the selected group before rejecting that group, so it can preserve a valid four-player group while rotating partners.
- Registered reciprocal fixed-partner duos ("luggages") are exempt and always remain together.
- Tournament fixtures are excluded from this Open Play rotation rule; interclub registered duos are governed by the tournament roster rules.
- The Pages state API independently validates newly generated or edited active/upcoming Open Play matchups, so the rule cannot be bypassed by submitting a handcrafted state. Existing historical matches are not retroactively changed.
