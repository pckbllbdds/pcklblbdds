# Pickleball Buddies Qatar — Homepage + Match Center

This is the GitHub-ready Cloudflare Pages site for Pickleball Buddies Qatar. The supplied club homepage is served at the root URL, and the existing Match Center is preserved at `/match-center/`. It follows the dashboard-based Cloudflare setup used for Pantheon Tools: D1 is created and initialized in the Cloudflare dashboard, and Pages Functions receive the database through a dashboard binding. Node.js and Wrangler are not required for the deployment flow in this README.

## Public homepage and Match Center routes

- `/` serves the new Pickleball Buddies Qatar public homepage with the hero carousel, community gallery, shared announcements, a static sponsor/partner card grid, achievements section, Facebook and Reclub links, and Match Center calls-to-action.
- `/match-center/` serves the supplied Match Center v12 page. Public visitors can view the match board, player search, leaderboards and any published round-robin tournament schedule and standings.
- Homepage Match Center links use the same-site `/match-center/` route. The homepage Admin Login is the only sign-in flow: after login it redirects to `/match-center/?organizer=1`. Match Center checks the existing HttpOnly organizer cookie and opens Manage session; it never asks for the password a second time. API calls remain at `/api/state` and `/api/auth`, so no D1 change is required.
- The homepage includes an Organizer-only Homepage Manager. Signed-in organizers can upload and remove hero-carousel/gallery photos, publish/edit/delete announcements, and add/edit/delete shared sponsor and advertisement entries. The sponsor list appears as a static card grid on the homepage. The supplied Match Center v12 contains its own featured-brand sidebar. Image files and homepage content are stored using the existing D1 binding. The media API automatically creates a separate `homepage_media` table on first use; there is no second Worker, Pages project, R2 bucket, or extra Cloudflare binding to configure. Public visitors see the same shared images and announcements.

## What changed from the supplied Match Center HTML

- The old browser-only `localStorage` persistence has been removed.
- Shared match data is loaded from and saved to Cloudflare D1 through Pages Functions.
- The public match board refreshes from D1 every 10 seconds.
- The Manage session and Players tabs are hidden from visitors and shown only when Match Center verifies the organizer cookie issued by the homepage. There is no Match Center password prompt or logout control; sign-in and logout remain on the homepage.
- Writes include a revision number. If another organizer saves first, the later save is rejected and the browser loads the latest shared state instead of silently overwriting it.
- The existing match generation, player management, leaderboard, court status and match scoring logic is retained.
- Interclub Tournament Mode provides a public, read-only single round-robin schedule and an Organizer-only setup/editor. Every club plays every other club exactly once. Each club matchup contains multiple generated doubles games based on the registered players for both clubs; every completed doubles game adds one win to the winning club, and the club with the most wins across the tournament finishes first.
- Tournament fixture editing is stable while open: fixture fields are staged and saved explicitly, the 10-second background refresh pauses while a match editor is open, and score/result saves update only the tournament view while preserving the open editor and bracket scroll position.
- The public Match Center opens on the Match board. Its organizer tools are opened by the homepage login redirect, not by a separate Organizer button in the Match Center header.
- A minimal “Join us on Facebook” text link appears in the public sidebar and opens the club Facebook page.
- The Reset Session action remains separated at the bottom of the Organizer view, away from routine session controls. Its existing confirmation prompt and reset behavior are preserved.
- The interface has been refined for phones: the navigation uses touch-friendly layouts, court cards reflow into a grid, player and leaderboard tables scroll within their own containers, and score-entry and organizer controls stack cleanly on narrow screens. The wider desktop layout is retained.

## Organizer device sign-in

The homepage performs the password check and creates a browser-specific, signed session cookie. The cookie is `HttpOnly`, `Secure`, and `SameSite=Strict`; it is not exposed to page JavaScript or stored in local storage. Match Center only verifies that cookie and opens its organizer tools when the homepage redirects with `?organizer=1`. Use the homepage logout control to clear the browser's cookie. Changing the Cloudflare `ADMIN_PASSWORD` invalidates previously issued device cookies. No D1 migration is required for this feature.

## Files

```text
index.html                  # Public club homepage
match-center/
  index.html                # Existing interactive Match Center
schema.sql
functions/
  api/
    auth.js
    state.js
    home-content.js
    home-media.js
  media/
    [key].js
  _shared/
    auth.js
```

The app expects a D1 binding named `DB` (`env.DB` in the Pages Functions). The existing app state is stored as one JSON document in the D1 table `app_state`; this preserves the current app state model and match logic instead of requiring a rewrite into separate player and match tables. The revision check helps prevent silent concurrent overwrites, but this is designed for one organizer making changes at a time, not heavy simultaneous multi-organizer editing. The homepage content API merges homepage metadata into this same JSON document with a compare-and-swap retry so a homepage edit does not overwrite a concurrent Match Center update. Homepage image binaries are stored in the separate `homepage_media` D1 table; the app state document stores only image keys and announcement metadata.

## 1. Put the project in GitHub

1. Create a new GitHub repository, for example `pickleball-buddies-qatar`.
2. Upload the contents of this project folder to the repository root. The homepage `index.html`, the `match-center/` directory, `schema.sql`, and the `functions/` directory must be at the top level.
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

## 6. Set the homepage organizer password

The public match board is readable by visitors. The homepage Admin Login uses the shared organizer password; Match Center receives the resulting session cookie and does not request the password again.

1. Open the Pages project in Cloudflare.
2. Go to **Settings → Variables and Secrets**.
3. Under the **Production** environment, add a secret named `ADMIN_PASSWORD`.
4. Enter a strong, unique password and save it as an encrypted secret.
5. Redeploy the Pages project so the secret is available to the Functions.

Do not put the password in GitHub, `index.html`, or any other public file. Give it only to trusted organizers.

## 7. Homepage photo storage (automatic)

Homepage images use the existing D1 binding named `DB`. The first authenticated upload creates the `homepage_media` table automatically. No R2 bucket, additional binding, Worker, Pages project, manual SQL migration, or separate storage setup is required.

Photos are automatically resized/compressed in the browser to fit D1's 2 MB maximum BLOB/row size. Stored image uploads are limited to 1.7 MB. Animated GIFs are preserved and accepted when they already fit this limit. JPEG, PNG, WebP and GIF are supported; SVG is rejected.

## 8. Check the deployment

Open the deployed `*.pages.dev` URL to see the public homepage. Select **Match Center** to open `/match-center/`.

- In Match Center, the status strip near the top should say that the shared database is connected.
- The public view should load even when no players have been added yet.
- Use **Admin Login** on the homepage. After successful sign-in, the homepage opens Match Center directly in **Manage session**. The **Players** tab is also available during that authenticated session.
- Add a test player, then open the site in another browser/device. The public view should show the updated player/match data after the next refresh cycle (within about 10 seconds).

If the status strip reports a D1 problem, verify that the D1 binding is named `DB`, that it points to `pickleball-buddies-qatar`, and that the `schema.sql` statements were successfully executed in that database's SQL Console. If writes are disabled, verify that the Production secret `ADMIN_PASSWORD` exists and redeploy.

## Important notes

- The public API intentionally allows read access. Do not store private or sensitive personal information in player names or match records.
- The organizer password is a shared password, not individual accounts or role-based access. Anyone who knows it can use the homepage Admin Login to manage the roster, results and reset the session.
- This version stores the entire app state as one JSON document. A revision check protects against silent concurrent overwrites, but simultaneous edits by multiple organizers may cause one save to be rejected. The affected browser will load the newest data and ask the organizer to re-apply the change.
- D1 starts with a clean session. Data previously stored by the old browser-only version is not automatically uploaded to the new database.


## Leaderboard update
- Skill hierarchy is Beginner → Advanced beginner → Novice → Lower intermediate → Intermediate → High intermediate → Advance. The existing D1 value `Advance beginner` is retained internally for compatibility and displayed as “Advanced beginner”.
- Normal-match leaderboards exclude Tournament Mode results and rank players by most wins, fewest losses, highest total points scored, then fewest total points conceded. Points for and points against are both shown. Players still tied after all four criteria share the same rank. Games count completed matches only; win rate is not used.
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
- Tournament Mode opens a dedicated public Interclub Tournament tab. It is separate from everyday Open Play matchmaking and has its own club rosters, gender format, game generation, scoring and round-robin standings.
- Home-club players are imported from the existing Players directory; all registered players are selected automatically by default, regardless of whether they are marked available for everyday Open Play. Organizers may deselect players who are not entering the event. Organizers register the opposing club names and their players, with skill bracket, gender and optional fixed partner. Unpaired players are automatically paired within their own club, subject to the Beginner skill restriction and selected gender format.
- For each club-vs-club tie, the app creates one doubles game for every compatible matchup of two players from Club A against two players from Club B. Each player is used once in the regular games for that tie; existing fixed duos stay together. If a club has more eligible duos than its opponent, the smaller roster determines the game count and the remaining duo sits out that tie.
- Every completed doubles game adds one win to the winning club and one loss to the other club. There are no elimination rounds or deciding games; all clubs play every other club once, with a bye each round when the field has an odd number of clubs. The final standings rank clubs by total completed game wins.
- The browser and Pages state API validate roster membership, fixed duos, skill compatibility, gender formats, individual game scores, round-robin pairing uniqueness and standings. No D1 schema migration is required because roster and tournament data are stored in the existing JSON state row.

## Interclub Tournament tab

- Enabling Tournament Mode opens a dedicated public Interclub Tournament tab. Visitors can see every round-robin fixture, all generated individual doubles games, live scores, completed game results and the tournament standings ranked by total wins. Only the Organizer can edit the event.
- Organizers can configure the tournament name, select the home-club roster from registered PBB players, and register 2–16 participating clubs including Pickleball Buddies Qatar.
- Each opponent club has its own roster. Register at least two eligible players per club; assign fixed partners where needed or allow automatic pairing. Each compatible duo on one club plays one doubles game against a compatible duo from the other club: four eligible players per club generate two games; eight generate four. If rosters differ in size, the smaller number of eligible duos determines the game count and extra duos sit out that tie.
- The complete round-robin schedule and all doubles games for every club matchup are generated together when the Organizer selects **Generate round-robin schedule & games**. Every pair of clubs appears exactly once in the schedule.
- Every individual doubles game has its own schedule, court, venue, notes, status, live score and final score. The score limit is 11 points maximum per side and 21 combined, with no tied final result.
- Each completed doubles game contributes one win to the winning club. The standings show wins, losses, games played and points for/against. When all scheduled games are complete, the club or clubs with the most wins are shown as the tournament winner; tied leaders share the top position.
- Tournament editing pauses the 10-second background refresh while a game editor is open. Saves preserve the current game editor and bracket scroll position; scoring updates refresh only the Tournament view rather than rebuilding the entire app.
- Disabling Tournament Mode hides the tab but preserves its saved roster and round-robin schedule. Tournament data is stored in the existing `app_state.state_json` record; no D1 schema migration is required.

### Public interclub round-robin tournament

When Tournament Mode is enabled, visitors can open the Interclub Tournament tab without signing in. The public display shows each round, every club matchup and every doubles game inside it: player names, scheduled details, LIVE NOW status and live score, completed scores, per-club win/loss standings and the eventual tournament leader or tied leaders. The public GET endpoint is read-only; organizers alone can register rosters, edit game details and record scores. Updates use the existing 10-second shared-state refresh, which pauses while an Organizer has a game editor open to avoid disrupting active edits.


### Open Play partner rotation

- In normal Open Play matchmaking, two non-fixed players cannot be teammates for more than two consecutive matches. The streak is measured across each player's successive match appearances: if either player appears in a different pairing, the streak is broken.
- The generator evaluates alternate doubles-team splits for the selected group before rejecting that group, so it can preserve a valid four-player group while rotating partners.
- Registered reciprocal fixed-partner duos ("luggages") are exempt and always remain together.
- Tournament fixtures are excluded from this Open Play rotation rule; interclub registered duos are governed by the tournament roster rules.
- The Pages state API independently validates newly generated or edited active/upcoming Open Play matchups, so the rule cannot be bypassed by submitting a handcrafted state. Existing historical matches are not retroactively changed.


### Homepage administrator entry point and content management
- The public homepage navigation includes **Admin Login**. After the shared Organizer password is accepted, the homepage redirects to Match Center with `?organizer=1`; Match Center validates the existing device session and opens its protected Manage session tab. Returning to the homepage on that device also reveals the private **Homepage Manager** panel.
- The Homepage Manager controls hero-carousel photos, static community-gallery photos, announcements shown in PBB Updates & Moments, and sponsor/advertisement entries displayed on the homepage. The homepage sponsor section is a static card grid (not a carousel); sponsor advert artwork can be uploaded per sponsor and appears on its homepage card. The supplied Match Center v12 retains its separate featured-brand sidebar. Organizers can upload photos and choose Hero carousel / Gallery (not carousel) / Both placement. The published media library labels whether each image is used in a carousel or in a static placement. Announcement photos are not added to the homepage photo carousel. The Join Our Community popup rotates its Reclub, Facebook and DUPR options while open.
- Public visitors receive the same published homepage content. The homepage loads content from `/api/home-content`; only the authenticated Organizer can save it.
- Homepage images are stored in the self-initializing `homepage_media` table in the existing D1 database and served by `/media/:key`. Photos are automatically compressed in the browser to 1.7 MB or less (D1 permits a maximum 2,000,000-byte BLOB or row); animated GIFs are preserved if they already fit. JPEG, PNG, WebP and GIF are supported; SVG is rejected.
- Announcement text and image-key metadata are stored under `homepageContent` in the existing D1 state JSON. The Match Center state API preserves this field when older clients submit normalized session state. No D1 schema migration is required.
- The same existing HttpOnly device session, homepage Organizer password, and `/api/auth` Pages Function are used. Match Center has no separate login or logout flow. No second login system or new secret is introduced.
