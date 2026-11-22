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
  // Interclub tournament bracket validation. Tournament data is stored inside the
  // existing shared JSON state, so this does not require a D1 schema migration.
  if (state.interclubTournament != null) {
    const tournament = state.interclubTournament;
    if (!tournament || typeof tournament !== "object" || typeof tournament.name !== "string" || tournament.name.length > 80 ||
        !Array.isArray(tournament.clubs) || !Array.isArray(tournament.rounds) ||
        tournament.clubs.length < 1 || tournament.clubs.length > 16 || tournament.rounds.length > 4) {
      return json({ error: "The interclub tournament setup is invalid. Use between 1 and 16 clubs." }, 400);
    }
    const clubIds = new Set();
    for (const club of tournament.clubs) {
      if (!club || typeof club.id !== "string" || !club.id || typeof club.name !== "string" || !club.name.trim() || club.name.length > 60 || clubIds.has(club.id)) {
        return json({ error: "Each tournament club needs a unique ID and a valid name." }, 400);
      }
      clubIds.add(club.id);
    }
    const tournamentMatchIds = new Set();
    for (const round of tournament.rounds) {
      if (!Array.isArray(round) || round.length > 8) {
        return json({ error: "The tournament bracket rounds are invalid." }, 400);
      }
      for (const match of round) {
        if (!match || typeof match.id !== "string" || !match.id || tournamentMatchIds.has(match.id) ||
            !["waiting", "scheduled", "in-progress", "complete", "bye"].includes(match.status)) {
          return json({ error: "A tournament fixture has an invalid ID or status." }, 400);
        }
        tournamentMatchIds.add(match.id);
        if (match.clubAId != null && match.clubBId != null && String(match.clubAId) === String(match.clubBId)) {
          return json({ error: "A tournament fixture cannot match a club against itself." }, 400);
        }
        for (const clubId of [match.clubAId, match.clubBId, match.winnerClubId]) {
          if (clubId != null && !clubIds.has(String(clubId))) {
            return json({ error: "A tournament fixture references a club that is not registered." }, 400);
          }
        }
        if (match.status === "in-progress" && (match.scoreA != null || match.scoreB != null)) {
          const a = match.scoreA, b = match.scoreB;
          if (!match.clubAId || !match.clubBId || !Number.isInteger(a) || !Number.isInteger(b) ||
              a < 0 || b < 0 || a > 11 || b > 11 || a + b > 21 || match.winnerClubId != null) {
            return json({ error: "Live tournament scores must be whole numbers, no higher than 11 per club or 21 combined, and cannot declare a winner before completion." }, 400);
          }
        }
        if (match.status === "complete") {
          const a = match.scoreA, b = match.scoreB;
          if (!match.clubAId || !match.clubBId || ![match.clubAId, match.clubBId].includes(match.winnerClubId) ||
              !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 11 || b > 11 || a + b > 21 || a === b ||
              match.winnerClubId !== (a > b ? match.clubAId : match.clubBId)) {
            return json({ error: "Completed tournament results need a valid score and matching winner." }, 400);
          }
        }
        if (match.status === "bye" && !(match.round === 1 && match.winnerClubId && [match.clubAId, match.clubBId].filter(Boolean).length === 1 && match.winnerClubId === (match.clubAId || match.clubBId))) {
          return json({ error: "Only a first-round bye may automatically advance its sole participating club." }, 400);
        }
        if (match.scheduledAt != null && (typeof match.scheduledAt !== "string" || match.scheduledAt.length > 100)) {
          return json({ error: "A tournament fixture date/time value is invalid." }, 400);
        }
        for (const field of ["court", "venue", "fixtureType", "notes"]) {
          if (match[field] != null && (typeof match[field] !== "string" || match[field].length > (field === "notes" ? 500 : 100))) {
            return json({ error: "A tournament fixture detail is too long or invalid." }, 400);
          }
        }
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
