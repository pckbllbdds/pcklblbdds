import { isOrganizerAuthorized } from "../_shared/auth.js";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function latestState(db) {
  return db
    .prepare("SELECT state_json, revision, updated_at FROM app_state WHERE id = 1")
    .first();
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);

  try {
    const row = await latestState(env.DB);
    if (!row) return json({ error: "D1 is connected, but its migration has not been applied." }, 503);

    return json({
      state: JSON.parse(row.state_json),
      revision: row.revision,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error("D1 read error:", error);
    return json({ error: "Could not read the shared match state." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not configured. Writes are disabled." }, 503);

  if (!(await isOrganizerAuthorized(request, env))) {
    const row = await latestState(env.DB);
    return json({
      error: "Organizer password was not accepted.",
      ...(row ? { state: JSON.parse(row.state_json), revision: row.revision } : {}),
    }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const state = body?.state;
  const revision = Number(body?.revision);
  if (
    !state || typeof state !== "object" ||
    !Array.isArray(state.players) || !Array.isArray(state.matches) ||
    !Number.isInteger(state.seq) || state.seq < 1 ||
    !Number.isInteger(revision) || revision < 1
  ) {
    return json({ error: "The submitted match state or revision is invalid." }, 400);
  }

  // Validate only results that are newly completed or whose score has changed.
  // This protects new match entries without blocking unrelated saves because of legacy results.
  let previousState;
  try {
    const previousRow = await latestState(env.DB);
    previousState = previousRow ? JSON.parse(previousRow.state_json) : null;
  } catch (error) {
    console.error("D1 current-state validation read error:", error);
    return json({ error: "Could not verify the current match state." }, 500);
  }
  const previousMatches = new Map((previousState?.matches || []).map((match) => [String(match.id), match]));
  const playerById = new Map(state.players.map((player) => [String(player.id), player]));
  if (state.matchGenderMode != null && !["open", "girls", "boys", "girls-vs-boys"].includes(state.matchGenderMode)) {
    return json({ error: "The selected gender matchup format is invalid." }, 400);
  }
  if (state.tournamentMode != null && typeof state.tournamentMode !== "boolean") {
    return json({ error: "Tournament Mode must be enabled or disabled." }, 400);
  }
  // Interclub tournament validation. Version 2 stores a full doubles roster
  // and multiple individual games inside each club-vs-club bracket tie.
  if (state.interclubTournament != null) {
    const tournament = state.interclubTournament;
    if (!tournament || typeof tournament !== "object" || typeof tournament.name !== "string" || tournament.name.length > 80 ||
        !Array.isArray(tournament.clubs) || !Array.isArray(tournament.rounds) ||
        tournament.clubs.length < 1 || tournament.clubs.length > 16 || tournament.rounds.length > 4) {
      return json({ error: "The interclub tournament setup is invalid. Use between 1 and 16 clubs." }, 400);
    }
    if (tournament.formatVersion === 2) {
      const brackets = ["Beginner", "Advance beginner", "Novice", "Lower intermediate", "Intermediate", "High intermediate", "Advance"];
      if (!Array.isArray(tournament.roster) || tournament.roster.length > 1000 ||
          !["open", "girls", "boys", "girls-vs-boys"].includes(tournament.genderMode || "open")) {
        return json({ error: "The tournament roster or gender format is invalid." }, 400);
      }
      const clubById = new Map();
      for (const club of tournament.clubs) {
        if (!club || typeof club.id !== "string" || !club.id || typeof club.name !== "string" || !club.name.trim() || club.name.length > 60 || clubById.has(club.id)) {
          return json({ error: "Each tournament club needs a unique ID and a valid name." }, 400);
        }
        clubById.set(club.id, club);
      }
      if (tournament.clubs.filter((club) => club.isHome === true).length !== 1) {
        return json({ error: "The tournament must have exactly one home club." }, 400);
      }
      const rosterById = new Map();
      for (const person of tournament.roster) {
        if (!person || typeof person.id !== "string" || !person.id || rosterById.has(person.id) ||
            typeof person.clubId !== "string" || !clubById.has(person.clubId) ||
            typeof person.name !== "string" || !person.name.trim() || person.name.length > 80 ||
            !brackets.includes(person.bracket) || !["female", "male", "unspecified"].includes(person.gender || "unspecified") ||
            (person.partnerId != null && typeof person.partnerId !== "string") ||
            (person.sourcePlayerId != null && typeof person.sourcePlayerId !== "string" && typeof person.sourcePlayerId !== "number")) {
          return json({ error: "A tournament roster player has invalid details or references an unknown club." }, 400);
        }
        rosterById.set(person.id, person);
      }
      for (const person of tournament.roster) {
        if (person.partnerId) {
          const partner = rosterById.get(String(person.partnerId));
          if (!partner || partner.id === person.id || partner.clubId !== person.clubId || String(partner.partnerId || "") !== person.id) {
            return json({ error: "Tournament fixed partners must be reciprocal pairs registered to the same club." }, 400);
          }
          const pairHasBeginner = person.bracket === "Beginner" || partner.bracket === "Beginner";
          const pairHasLower = ["Lower intermediate", "Intermediate", "High intermediate", "Advance"].includes(person.bracket) || ["Lower intermediate", "Intermediate", "High intermediate", "Advance"].includes(partner.bracket);
          if (pairHasBeginner && pairHasLower) return json({ error: "Beginner players cannot be paired with Lower Intermediate or higher." }, 400);
        }
      }
      const tieIds = new Set(), gameIds = new Set();
      for (const round of tournament.rounds) {
        if (!Array.isArray(round) || round.length > 8) return json({ error: "The tournament bracket rounds are invalid." }, 400);
        for (const tie of round) {
          if (!tie || typeof tie.id !== "string" || !tie.id || tieIds.has(tie.id) ||
              !["waiting", "scheduled", "in-progress", "complete", "bye"].includes(tie.status) ||
              !Array.isArray(tie.games) || tie.games.length > 100) {
            return json({ error: "A club tie has an invalid ID, status, or game list." }, 400);
          }
          tieIds.add(tie.id);
          for (const clubId of [tie.clubAId, tie.clubBId, tie.winnerClubId]) {
            if (clubId != null && !clubById.has(String(clubId))) return json({ error: "A club tie references a club that is not registered." }, 400);
          }
          if (tie.clubAId != null && tie.clubBId != null && String(tie.clubAId) === String(tie.clubBId)) return json({ error: "A club cannot play against itself." }, 400);
          const regularUsed = new Set();
          let winsA = 0, winsB = 0, unfinished = 0, tiebreakers = 0;
          for (const game of tie.games) {
            if (!game || typeof game.id !== "string" || !game.id || gameIds.has(game.id) ||
                !["scheduled", "in-progress", "complete"].includes(game.status) ||
                !Array.isArray(game.teamA) || !Array.isArray(game.teamB) || game.teamA.length !== 2 || game.teamB.length !== 2 ||
                new Set([...game.teamA, ...game.teamB]).size !== 4) {
              return json({ error: "Each tournament doubles game must contain four unique registered players and a valid status." }, 400);
            }
            gameIds.add(game.id);
            if (!tie.clubAId || !tie.clubBId) return json({ error: "A doubles game cannot be created before both clubs are known." }, 400);
            const gamePeople = [...game.teamA, ...game.teamB].map((id) => rosterById.get(String(id)));
            if (gamePeople.some((p) => !p)) return json({ error: "A tournament game references a player who is not registered." }, 400);
            if (game.teamA.some((id) => rosterById.get(String(id)).clubId !== String(tie.clubAId)) ||
                game.teamB.some((id) => rosterById.get(String(id)).clubId !== String(tie.clubBId))) {
              return json({ error: "Each doubles team must represent its own registered club." }, 400);
            }
            const beginner = gamePeople.some((p) => p.bracket === "Beginner");
            const lower = gamePeople.some((p) => ["Lower intermediate", "Intermediate", "High intermediate", "Advance"].includes(p.bracket));
            if (beginner && lower) return json({ error: "A Beginner player cannot be matched with Lower Intermediate or higher." }, 400);
            for (const person of gamePeople) {
              if (person.partnerId) {
                const sameTeam = (game.teamA.includes(person.id) && game.teamA.includes(person.partnerId)) || (game.teamB.includes(person.id) && game.teamB.includes(person.partnerId));
                if (!sameTeam) return json({ error: "A fixed tournament duo cannot be split across teams or games." }, 400);
              }
            }
            const mode = game.genderMode || tournament.genderMode || "open";
            if (!["open", "girls", "boys", "girls-vs-boys"].includes(mode)) return json({ error: "A tournament game has an invalid gender format." }, 400);
            if (mode === "girls" && !gamePeople.every((p) => p.gender === "female")) return json({ error: "A girls-only tournament game must contain four female players." }, 400);
            if (mode === "boys" && !gamePeople.every((p) => p.gender === "male")) return json({ error: "A boys-only tournament game must contain four male players." }, 400);
            if (mode === "girls-vs-boys") {
              const teamAGirls = game.teamA.every((id) => rosterById.get(String(id)).gender === "female"), teamABoys = game.teamA.every((id) => rosterById.get(String(id)).gender === "male");
              const teamBGirls = game.teamB.every((id) => rosterById.get(String(id)).gender === "female"), teamBBoys = game.teamB.every((id) => rosterById.get(String(id)).gender === "male");
              if (!((teamAGirls && teamBBoys) || (teamABoys && teamBGirls))) return json({ error: "Girls vs Boys games must place two female players against two male players." }, 400);
            }
            if (!game.isTiebreaker) {
              for (const id of [...game.teamA, ...game.teamB].map(String)) {
                if (regularUsed.has(id)) return json({ error: "A player may appear only once in the regular games of a club tie." }, 400);
                regularUsed.add(id);
              }
            } else {
              tiebreakers++;
              if (tiebreakers > 1 || game.teamA.some((id, i) => String(id) !== String(tie.games[0]?.teamA?.[i])) || game.teamB.some((id, i) => String(id) !== String(tie.games[0]?.teamB?.[i]))) {
                return json({ error: "A deciding game may appear only once and must reuse the first game's registered duos." }, 400);
              }
            }
            if (game.status === "scheduled") {
              if (game.scoreA != null || game.scoreB != null || game.winnerClubId != null) return json({ error: "An upcoming tournament game cannot contain a score or winner." }, 400);
              unfinished++;
            } else if (game.status === "in-progress") {
              if ((game.scoreA == null) !== (game.scoreB == null) || game.winnerClubId != null) return json({ error: "A live game must have both scores or neither score, and cannot have a declared winner." }, 400);
              if (game.scoreA != null && (!Number.isInteger(game.scoreA) || !Number.isInteger(game.scoreB) || game.scoreA < 0 || game.scoreB < 0 || game.scoreA > 11 || game.scoreB > 11 || game.scoreA + game.scoreB > 21 || game.winnerClubId != null)) return json({ error: "Live scores must stay within 11 per team and 21 combined." }, 400);
              unfinished++;
            } else {
              if (!Number.isInteger(game.scoreA) || !Number.isInteger(game.scoreB) || game.winnerClubId == null || game.scoreA < 0 || game.scoreB < 0 || game.scoreA > 11 || game.scoreB > 11 || game.scoreA + game.scoreB > 21 || game.scoreA === game.scoreB || game.winnerClubId !== (game.scoreA > game.scoreB ? tie.clubAId : tie.clubBId)) {
                return json({ error: "A completed doubles game needs a valid score and winner." }, 400);
              }
              if (game.scoreA > game.scoreB) winsA++; else winsB++;
            }
            if (game.scheduledAt != null && (typeof game.scheduledAt !== "string" || game.scheduledAt.length > 100)) return json({ error: "A tournament game date/time value is invalid." }, 400);
            for (const field of ["court", "venue", "fixtureType", "notes"]) if (game[field] != null && (typeof game[field] !== "string" || game[field].length > (field === "notes" ? 500 : 100))) return json({ error: "A tournament game detail is too long or invalid." }, 400);
          }
          if (tie.gamesWonA != null && tie.gamesWonA !== winsA) return json({ error: "The club A game-win total does not match its completed games." }, 400);
          if (tie.gamesWonB != null && tie.gamesWonB !== winsB) return json({ error: "The club B game-win total does not match its completed games." }, 400);
          if (tie.status === "bye" && !(Number(tie.round) === 1 && tie.winnerClubId && [tie.clubAId, tie.clubBId].filter(Boolean).length === 1 && tie.winnerClubId === (tie.clubAId || tie.clubBId) && tie.games.length === 0)) return json({ error: "Only a first-round bye with no games may automatically advance its sole participating club." }, 400);
          if (tie.status !== "bye") {
            if (tie.clubAId && tie.clubBId && tie.games.length === 0) return json({ error: "A club tie must generate its doubles games as soon as both clubs are known." }, 400);
            const expectedStatus = !tie.clubAId || !tie.clubBId ? "waiting" : !tie.games.length ? "waiting" : tie.games.some(g => g.status === "in-progress") ? "in-progress" : tie.games.every(g => g.status === "complete") ? "complete" : "scheduled";
            if (tie.status !== expectedStatus) return json({ error: "The club tie status does not match the status of its individual doubles games." }, 400);
          }
          if (tie.status === "complete") {
            const decider = tie.games.find(g => g.isTiebreaker);
            const expectedWinner = winsA > winsB ? tie.clubAId : winsB > winsA ? tie.clubBId : decider?.status === "complete" ? decider.winnerClubId : null;
            if (unfinished || !tie.winnerClubId || !expectedWinner || tie.winnerClubId !== expectedWinner) return json({ error: "A completed club tie must have all games completed and the correct advancing club." }, 400);
          } else if (tie.status !== "bye" && tie.winnerClubId != null) return json({ error: "A club cannot advance before its club tie is complete or it receives a bye." }, 400);
        }
      }
      if (tournament.rounds.length) {
        if (tournament.clubs.length < 2) return json({ error: "A club bracket needs at least two registered clubs." }, 400);
        const bracketSize = 2 ** Math.ceil(Math.log2(tournament.clubs.length)), expectedRounds = Math.log2(bracketSize);
        if (tournament.rounds.length !== expectedRounds) return json({ error: "The tournament bracket is incomplete. Rebuild it using the registered club count." }, 400);
        const firstRoundEntrants = [];
        for (let roundIndex = 0; roundIndex < expectedRounds; roundIndex++) {
          const round = tournament.rounds[roundIndex], expectedMatches = bracketSize / (2 ** (roundIndex + 1));
          if (round.length !== expectedMatches) return json({ error: "The tournament bracket has an incorrect number of club ties in a round." }, 400);
          if (roundIndex === 0) {
            for (const tie of round) {
              if (Number(tie.round) !== 1 || tie.sourceA != null || tie.sourceB != null) return json({ error: "First-round ties must be direct club entries." }, 400);
              const entrants = [tie.clubAId, tie.clubBId].filter(Boolean).map(String);
              if (!entrants.length) return json({ error: "A first-round tie cannot be a double bye." }, 400);
              firstRoundEntrants.push(...entrants);
              if (entrants.length === 1 && (tie.status !== "bye" || String(tie.winnerClubId) !== entrants[0])) return json({ error: "A first-round bye must automatically advance its only club." }, 400);
              if (entrants.length === 2 && tie.status === "bye") return json({ error: "A bye cannot be assigned when both clubs are present." }, 400);
            }
          } else {
            const previousRound = tournament.rounds[roundIndex - 1], previousById = new Map(previousRound.map((tie) => [tie.id, tie])), usedSources = new Set();
            for (const tie of round) {
              if (Number(tie.round) !== roundIndex + 1 || !previousById.has(String(tie.sourceA)) || !previousById.has(String(tie.sourceB)) || String(tie.sourceA) === String(tie.sourceB)) return json({ error: "Each later-round tie must connect two distinct previous-round ties." }, 400);
              for (const sourceId of [String(tie.sourceA), String(tie.sourceB)]) { if (usedSources.has(sourceId)) return json({ error: "A previous-round winner cannot feed multiple ties." }, 400); usedSources.add(sourceId); }
              const expectedA = previousById.get(String(tie.sourceA)).winnerClubId || null, expectedB = previousById.get(String(tie.sourceB)).winnerClubId || null;
              if (String(tie.clubAId || "") !== String(expectedA || "") || String(tie.clubBId || "") !== String(expectedB || "")) return json({ error: "Later-round clubs must match the winners of their linked previous-round ties." }, 400);
              if ((!expectedA || !expectedB) && tie.status !== "waiting") return json({ error: "A tie must wait until both previous-round winners are known." }, 400);
              if (expectedA && expectedB && tie.status === "waiting") return json({ error: "A tie with both advancing clubs must generate its doubles games." }, 400);
            }
            if (usedSources.size !== previousRound.length) return json({ error: "Every previous-round tie must feed exactly one tie in the next round." }, 400);
          }
        }
        const uniqueEntrants = new Set(firstRoundEntrants);
        if (firstRoundEntrants.length !== tournament.clubs.length || uniqueEntrants.size !== tournament.clubs.length || tournament.clubs.some((club) => !uniqueEntrants.has(String(club.id)))) return json({ error: "Every registered club must appear exactly once in the opening round." }, 400);
      }
    }
  }
  for (const player of state.players) {
    if (player.gender != null && !["female", "male", "unspecified"].includes(player.gender)) {
      return json({ error: "A player's gender value is invalid." }, 400);
    }
    if (player.partnerId) {
      const partner = playerById.get(String(player.partnerId));
      if (!partner || String(partner.id) === String(player.id) || String(partner.partnerId || "") !== String(player.id)) {
        return json({ error: "Fixed partners must be valid reciprocal player pairs." }, 400);
      }
      const pairHasBeginner = player.bracket === "Beginner" || partner.bracket === "Beginner";
      const pairHasLowerIntermediateOrAbove = ["Lower intermediate", "Intermediate", "High intermediate", "Advance"].includes(player.bracket) || ["Lower intermediate", "Intermediate", "High intermediate", "Advance"].includes(partner.bracket);
      if (pairHasBeginner && pairHasLowerIntermediateOrAbove) {
        return json({ error: "A Beginner player cannot be fixed with a Lower intermediate or higher partner." }, 400);
      }
    }
  }

  // A registered duo cannot be split or partially queued while either partner is active/upcoming.
  for (const match of state.matches) {
    if (!match || !["upcoming", "playing"].includes(match.status)) continue;
    const teamA = new Set(Array.isArray(match.teamA) ? match.teamA.map(String) : []);
    const teamB = new Set(Array.isArray(match.teamB) ? match.teamB.map(String) : []);
    const ids = new Set([...teamA, ...teamB]);
    for (const id of ids) {
      const person = playerById.get(id);
      if (!person?.partnerId) continue;
      const partnerId = String(person.partnerId);
      const onSameTeam = (teamA.has(id) && teamA.has(partnerId)) || (teamB.has(id) && teamB.has(partnerId));
      if (!ids.has(partnerId) || !onSameTeam) {
        return json({ error: "A registered fixed duo cannot be separated in an active or upcoming match." }, 400);
      }
    }
  }

  // Validate newly generated or edited matchups when they enter the queue or start.
  for (const match of state.matches) {
    const previous = previousMatches.get(String(match.id));
    if (!match || !["upcoming", "playing"].includes(match.status)) continue;
    const matchupChanged = !previous || previous.status !== match.status ||
      JSON.stringify(previous.teamA || []) !== JSON.stringify(match.teamA || []) ||
      JSON.stringify(previous.teamB || []) !== JSON.stringify(match.teamB || []) ||
      previous.genderMode !== match.genderMode || previous.tournament !== match.tournament;
    if (!matchupChanged) continue;

    const teamA = Array.isArray(match.teamA) ? match.teamA : [];
    const teamB = Array.isArray(match.teamB) ? match.teamB : [];
    const ids = [...teamA, ...teamB];
    if (ids.length > 4 || new Set(ids.map(String)).size !== ids.length || ids.some((id) => !playerById.has(String(id)))) {
      return json({ error: "A doubles match may contain up to four different registered players." }, 400);
    }
    // An upcoming match may intentionally have an open slot while the organizer
    // replaces a player. Full skill/gender/tournament checks run when it is complete
    // and again when it is started. Tournament fixtures cannot be left incomplete.
    if (match.status === "upcoming" && ids.length < 4) {
      if (match.tournament === true) return json({ error: "Tournament fixtures must keep both registered duos intact." }, 400);
      continue;
    }
    if (ids.length !== 4) return json({ error: "A playing match must contain four different registered players." }, 400);
    const members = ids.map((id) => playerById.get(String(id)));
    const hasBeginner = members.some((p) => p.bracket === "Beginner");
    const hasLowerIntermediateOrAbove = members.some((p) => ["Lower intermediate", "Intermediate", "High intermediate", "Advance"].includes(p.bracket));
    if (hasBeginner && hasLowerIntermediateOrAbove) {
      return json({ error: "Beginner players cannot be matched with Lower intermediate or higher players." }, 400);
    }
    for (const player of members) {
      if (!player.partnerId) continue;
      const partner = playerById.get(String(player.partnerId));
      if (!partner || !ids.some((id) => String(id) === String(partner.id))) {
        return json({ error: "A fixed partner cannot be separated from their registered duo." }, 400);
      }
      const sameSide = (teamA.some((id) => String(id) === String(player.id)) && teamA.some((id) => String(id) === String(partner.id))) ||
        (teamB.some((id) => String(id) === String(player.id)) && teamB.some((id) => String(id) === String(partner.id)));
      if (!sameSide) return json({ error: "Fixed partners must play on the same team." }, 400);
    }
    if (match.tournament === true) {
      const isPair = (side) => side.length === 2 && side.every((id) => {
        const person = playerById.get(String(id));
        const partner = person?.partnerId ? playerById.get(String(person.partnerId)) : null;
        return partner && String(partner.partnerId || "") === String(person.id) && String(partner.id) === String(side.find((otherId) => String(otherId) !== String(id)));
      });
      if (!isPair(teamA) || !isPair(teamB)) return json({ error: "Tournament Mode requires two complete fixed duos, one duo per team." }, 400);
    }
    const genderMode = match.genderMode || "open";
    if (!["open", "girls", "boys", "girls-vs-boys"].includes(genderMode)) {
      return json({ error: "A match contains an invalid gender matchup format." }, 400);
    }
    const gendersA = teamA.map((id) => playerById.get(String(id)).gender || "unspecified");
    const gendersB = teamB.map((id) => playerById.get(String(id)).gender || "unspecified");
    const allGenders = gendersA.concat(gendersB);
    if (genderMode === "girls" && !allGenders.every((gender) => gender === "female")) {
      return json({ error: "Girls-only matches require four players registered as female." }, 400);
    }
    if (genderMode === "boys" && !allGenders.every((gender) => gender === "male")) {
      return json({ error: "Boys-only matches require four players registered as male." }, 400);
    }
    if (genderMode === "girls-vs-boys" && !(
      (gendersA.every((gender) => gender === "female") && gendersB.every((gender) => gender === "male")) ||
      (gendersA.every((gender) => gender === "male") && gendersB.every((gender) => gender === "female"))
    )) {
      return json({ error: "Girls vs Boys requires one all-female team against one all-male team." }, 400);
    }
  }

  for (const match of state.matches) {
    if (!match || match.status !== "done") continue;
    const previous = previousMatches.get(String(match.id));
    const isNewOrChangedResult = !previous || previous.status !== "done" ||
      Number(previous.scoreA) !== Number(match.scoreA) || Number(previous.scoreB) !== Number(match.scoreB);
    if (!isNewOrChangedResult) continue;

    const scoreA = match.scoreA;
    const scoreB = match.scoreB;
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
      return json({ error: "Match scores must be whole numbers of 0 or higher." }, 400);
    }
    if (scoreA > 11 || scoreB > 11) {
      return json({ error: "Each team can score a maximum of 11 points." }, 400);
    }
    if (scoreA + scoreB > 21) {
      return json({ error: "The combined score for a match cannot exceed 21 points." }, 400);
    }
    if (scoreA === scoreB) {
      return json({ error: "Completed match scores cannot be tied." }, 400);
    }
  }

  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).byteLength > 900_000) {
    return json({ error: "The session data is too large to save." }, 413);
  }

  try {
    const result = await env.DB.prepare(
      `UPDATE app_state
       SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND revision = ?`
    ).bind(serialized, revision).run();

    if (result.meta.changes !== 1) {
      const row = await latestState(env.DB);
      if (!row) return json({ error: "The shared session row is missing. Re-apply the D1 migration." }, 503);
      return json({
        error: "A newer version of the session already exists.",
        state: JSON.parse(row.state_json),
        revision: row.revision,
        updatedAt: row.updated_at,
      }, 409);
    }

    const row = await latestState(env.DB);
    return json({
      ok: true,
      revision: row.revision,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error("D1 write error:", error);
    return json({ error: "Could not save the shared match state." }, 500);
  }
}
