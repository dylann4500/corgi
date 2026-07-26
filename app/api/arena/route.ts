import { ensureArenaSchema, getD1 } from "../../../db";
import { env } from "cloudflare:workers";
import {
  barkPrompts,
  parseBarkFeatures,
  parseBarkScore,
  scoreBark,
} from "../../../lib/bark-scoring";

type RoomRow = {
  id: string;
  player1_id: string;
  player2_id: string;
  prompt_index: number;
  status: string;
  player1_ready: number;
  player2_ready: number;
  starts_at: number | null;
  player1_score: string | null;
  player2_score: string | null;
  rated: number;
  player1_name: string;
  player2_name: string;
  player1_rating: number;
  player2_rating: number;
  player1_wins: number;
  player2_wins: number;
  player1_losses: number;
  player2_losses: number;
  created_at: number;
};

type SignalRow = {
  id: number;
  payload: string;
};

const ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const ROOM_PATTERN = /^[a-zA-Z0-9-]{20,80}$/;
const METERED_APP_PATTERN = /^[a-z0-9-]{2,63}$/;
const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cleanName(value: unknown) {
  const name = typeof value === "string" ? value.replace(/[^\p{L}\p{N} _-]/gu, "").trim() : "";
  return name.slice(0, 24) || "Anonymous Pup";
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function validRoom(value: unknown): value is string {
  return typeof value === "string" && ROOM_PATTERN.test(value);
}

function normalizeIceServers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const urls = Array.isArray(record.urls)
      ? record.urls.filter(
          (url): url is string =>
            typeof url === "string" && /^(stun|turn|turns):/i.test(url),
        )
      : typeof record.urls === "string" && /^(stun|turn|turns):/i.test(record.urls)
        ? record.urls
        : null;
    if (!urls || (Array.isArray(urls) && urls.length === 0)) return [];
    return [
      {
        urls,
        ...(typeof record.username === "string" ? { username: record.username } : {}),
        ...(typeof record.credential === "string" ? { credential: record.credential } : {}),
      },
    ];
  });
}

async function getMeteredIceServers(appName: string, apiKey: string) {
  if (!METERED_APP_PATTERN.test(appName)) return [];
  try {
    const credentialUrl = new URL(
      `https://${appName}.metered.live/api/v1/turn/credentials`,
    );
    credentialUrl.searchParams.set("apiKey", apiKey);
    const credentialResponse = await fetch(credentialUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!credentialResponse.ok) return [];
    return normalizeIceServers(await credentialResponse.json());
  } catch {
    return [];
  }
}

function safeScore(value: string | null) {
  if (!value) return null;
  try {
    return parseBarkScore(JSON.parse(value));
  } catch {
    return null;
  }
}

async function getRoom(roomId: string) {
  const db = getD1();
  return db
    .prepare(`SELECT
      r.*,
      p1.name AS player1_name,
      p2.name AS player2_name,
      p1.rating AS player1_rating,
      p2.rating AS player2_rating,
      p1.wins AS player1_wins,
      p2.wins AS player2_wins,
      p1.losses AS player1_losses,
      p2.losses AS player2_losses
    FROM rooms r
    JOIN players p1 ON p1.id = r.player1_id
    JOIN players p2 ON p2.id = r.player2_id
    WHERE r.id = ?`)
    .bind(roomId)
    .first<RoomRow>();
}

function roomView(room: RoomRow, playerId: string) {
  const isPlayer1 = room.player1_id === playerId;
  const member = isPlayer1 || room.player2_id === playerId;
  if (!member) return null;
  return {
    id: room.id,
    role: isPlayer1 ? "offerer" : "answerer",
    promptIndex: room.prompt_index,
    status: room.status,
    ready: Boolean(isPlayer1 ? room.player1_ready : room.player2_ready),
    rivalReady: Boolean(isPlayer1 ? room.player2_ready : room.player1_ready),
    startsAt: room.starts_at,
    score: safeScore(isPlayer1 ? room.player1_score : room.player2_score),
    rivalScore: safeScore(isPlayer1 ? room.player2_score : room.player1_score),
    rival: {
      name: isPlayer1 ? room.player2_name : room.player1_name,
      rating: isPlayer1 ? room.player2_rating : room.player1_rating,
    },
    rating: isPlayer1 ? room.player1_rating : room.player2_rating,
    record: {
      wins: isPlayer1 ? room.player1_wins : room.player2_wins,
      losses: isPlayer1 ? room.player1_losses : room.player2_losses,
    },
  };
}

async function maybeFinalize(room: RoomRow) {
  if (room.rated || !room.player1_score || !room.player2_score) return;
  const db = getD1();
  const lock = await db
    .prepare("UPDATE rooms SET rated = 1, status = 'complete', updated_at = ? WHERE id = ? AND rated = 0")
    .bind(Date.now(), room.id)
    .run();
  if (!lock.meta?.changes) return;

  const score1 = safeScore(room.player1_score)?.total ?? 0;
  const score2 = safeScore(room.player2_score)?.total ?? 0;
  const outcome1 = score1 === score2 ? 0.5 : score1 > score2 ? 1 : 0;
  const expected1 = 1 / (1 + Math.pow(10, (room.player2_rating - room.player1_rating) / 400));
  const change1 = Math.round(24 * (outcome1 - expected1));
  const change2 = -change1;
  const p1Win = score1 > score2 ? 1 : 0;
  const p2Win = score2 > score1 ? 1 : 0;
  const p1Loss = score1 < score2 ? 1 : 0;
  const p2Loss = score2 < score1 ? 1 : 0;
  const now = Date.now();

  await db.batch([
    db
      .prepare("UPDATE players SET rating = MAX(800, rating + ?), wins = wins + ?, losses = losses + ?, updated_at = ? WHERE id = ?")
      .bind(change1, p1Win, p1Loss, now, room.player1_id),
    db
      .prepare("UPDATE players SET rating = MAX(800, rating + ?), wins = wins + ?, losses = losses + ?, updated_at = ? WHERE id = ?")
      .bind(change2, p2Win, p2Loss, now, room.player2_id),
  ]);
}

async function pollRoom(playerId: string, requestedRoomId: string | null, afterSignalId: number) {
  const db = getD1();
  let roomId = requestedRoomId;
  if (!roomId) {
    const queued = await db
      .prepare("SELECT room_id FROM match_queue WHERE player_id = ?")
      .bind(playerId)
      .first<{ room_id: string | null }>();
    roomId = queued?.room_id ?? null;
  }
  await db.prepare("UPDATE match_queue SET last_seen = ? WHERE player_id = ?").bind(Date.now(), playerId).run();
  if (!roomId) return { state: "waiting" };

  let room = await getRoom(roomId);
  if (!room) return { state: "waiting" };
  if (room.player1_id !== playerId && room.player2_id !== playerId) return { state: "forbidden" };

  const rivalId = room.player1_id === playerId ? room.player2_id : room.player1_id;
  const rivalPresence = await db
    .prepare("SELECT last_seen FROM match_queue WHERE player_id = ?")
    .bind(rivalId)
    .first<{ last_seen: number }>();
  if (
    room.status !== "complete" &&
    room.status !== "abandoned" &&
    (!rivalPresence || rivalPresence.last_seen < Date.now() - 25_000)
  ) {
    await db
      .prepare("UPDATE rooms SET status = 'abandoned', updated_at = ? WHERE id = ?")
      .bind(Date.now(), room.id)
      .run();
    room = (await getRoom(room.id)) ?? room;
  }

  if (room.status === "abandoned") {
    await db
      .prepare("DELETE FROM match_queue WHERE player_id = ? AND room_id = ?")
      .bind(playerId, room.id)
      .run();
  }

  if (room.player1_ready && room.player2_ready && !room.starts_at) {
    const startsAt = Date.now() + 4000;
    await db
      .prepare("UPDATE rooms SET starts_at = ?, status = 'countdown', updated_at = ? WHERE id = ? AND starts_at IS NULL")
      .bind(startsAt, Date.now(), room.id)
      .run();
    room = (await getRoom(room.id)) ?? room;
  }

  await maybeFinalize(room);
  room = (await getRoom(room.id)) ?? room;

  const signalResult = await db
    .prepare("SELECT id, payload FROM signals WHERE room_id = ? AND recipient_id = ? AND id > ? ORDER BY id ASC LIMIT 100")
    .bind(room.id, playerId, afterSignalId)
    .all<SignalRow>();
  const signals = signalResult.results.map((signal) => {
    try {
      return { id: signal.id, payload: JSON.parse(signal.payload) };
    } catch {
      return { id: signal.id, payload: null };
    }
  });

  return { state: "matched", room: roomView(room, playerId), signals };
}

export async function GET(request: Request) {
  try {
    await ensureArenaSchema();
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const db = getD1();

    if (action === "ice") {
      const playerId = url.searchParams.get("playerId");
      const roomId = url.searchParams.get("roomId");
      if (!validId(playerId) || !validRoom(roomId)) {
        return response({ error: "A valid matched room is required." }, 400);
      }
      const room = await getRoom(roomId);
      const isMember =
        room && (room.player1_id === playerId || room.player2_id === playerId);
      const roomIsActive =
        room &&
        (room.status === "matched" || room.status === "countdown") &&
        room.created_at > Date.now() - 15 * 60_000;
      if (!isMember || !roomIsActive) {
        return response({ error: "Active match not found." }, 404);
      }

      const now = Date.now();
      await db
        .prepare("DELETE FROM turn_grants WHERE created_at < ?")
        .bind(now - 60 * 60_000)
        .run();
      const grant = await db
        .prepare(`INSERT INTO turn_grants (room_id, player_id, created_at)
          SELECT ?, ?, ?
          WHERE (
            SELECT COUNT(*) FROM turn_grants
            WHERE player_id = ? AND created_at > ?
          ) < 8`)
        .bind(roomId, playerId, now, playerId, now - 10 * 60_000)
        .run();
      if (!grant.meta?.changes) {
        return response({ error: "Relay request limit reached. Try again shortly." }, 429);
      }

      const runtime = env as unknown as {
        METERED_TURN_APP?: string;
        METERED_TURN_API_KEY?: string;
        TURN_KEY_ID?: string;
        TURN_KEY_API_TOKEN?: string;
      };
      if (runtime.METERED_TURN_APP && runtime.METERED_TURN_API_KEY) {
        const iceServers = await getMeteredIceServers(
          runtime.METERED_TURN_APP,
          runtime.METERED_TURN_API_KEY,
        );
        if (iceServers.length) {
          return response({ iceServers, relay: true, provider: "metered" });
        }
      }
      if (runtime.TURN_KEY_ID && runtime.TURN_KEY_API_TOKEN) {
        const credentialResponse = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(runtime.TURN_KEY_ID)}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${runtime.TURN_KEY_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ttl: 3600 }),
          },
        );
        if (credentialResponse.ok) {
          const credentials = (await credentialResponse.json()) as {
            iceServers?: Array<Record<string, unknown>>;
          };
          if (credentials.iceServers?.length) {
            const iceServers = normalizeIceServers(credentials.iceServers);
            if (!iceServers.length) {
              return response({
                iceServers: DEFAULT_ICE_SERVERS,
                relay: false,
                provider: "direct",
              });
            }
            return response({
              iceServers,
              relay: true,
              provider: "cloudflare",
            });
          }
        }
      }
      return response({
        iceServers: DEFAULT_ICE_SERVERS,
        relay: false,
        provider: "direct",
      });
    }

    if (action === "leaderboard") {
      const viewerId = url.searchParams.get("playerId");
      const safeViewerId = validId(viewerId) ? viewerId : "";
      const rows = await db
        .prepare(`SELECT name, rating, wins, losses, CASE WHEN id = ? THEN 1 ELSE 0 END AS is_you
          FROM players
          WHERE wins + losses > 0
          ORDER BY rating DESC, wins DESC
          LIMIT 12`)
        .bind(safeViewerId)
        .all<{ name: string; rating: number; wins: number; losses: number; is_you: number }>();
      return response({ players: rows.results });
    }

    if (action === "profile") {
      const playerId = url.searchParams.get("playerId");
      if (!validId(playerId)) {
        return response({ error: "Invalid player session." }, 400);
      }
      const profile = await db
        .prepare("SELECT id, name, rating, wins, losses FROM players WHERE id = ?")
        .bind(playerId)
        .first<{ id: string; name: string; rating: number; wins: number; losses: number }>();
      return response({ profile });
    }

    const playerId = url.searchParams.get("playerId");
    const roomId = url.searchParams.get("roomId");
    const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
    if (!validId(playerId) || (roomId && !validRoom(roomId))) {
      return response({ error: "Invalid arena session." }, 400);
    }
    return response(await pollRoom(playerId, roomId, after));
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Arena unavailable." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    await ensureArenaSchema();
    const payload = (await request.json()) as Record<string, unknown>;
    const action = payload.action;
    const playerId = payload.playerId;
    if (!validId(playerId)) return response({ error: "Invalid player session." }, 400);
    const db = getD1();
    const now = Date.now();

    if (action === "profile") {
      const name = cleanName(payload.name);
      await db
        .prepare(`INSERT INTO players (id, name, rating, wins, losses, created_at, updated_at)
          VALUES (?, ?, 1200, 0, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`)
        .bind(playerId, name, now, now)
        .run();
      const profile = await db
        .prepare("SELECT id, name, rating, wins, losses FROM players WHERE id = ?")
        .bind(playerId)
        .first<{ id: string; name: string; rating: number; wins: number; losses: number }>();
      return response({ profile });
    }

    if (action === "cancel") {
      await db
        .prepare("DELETE FROM match_queue WHERE player_id = ? AND room_id IS NULL")
        .bind(playerId)
        .run();
      return response({ ok: true });
    }

    if (action === "match") {
      const name = cleanName(payload.name);
      const startingRating = 1200;
      const previousQueue = await db
        .prepare(`SELECT q.room_id, r.status
          FROM match_queue q
          LEFT JOIN rooms r ON r.id = q.room_id
          WHERE q.player_id = ?`)
        .bind(playerId)
        .first<{ room_id: string | null; status: string | null }>();
      if (
        previousQueue?.room_id &&
        previousQueue.status &&
        !["complete", "abandoned"].includes(previousQueue.status)
      ) {
        return response(await pollRoom(playerId, previousQueue.room_id, 0));
      }

      await db.batch([
        db.prepare("DELETE FROM signals WHERE created_at < ?").bind(now - 10 * 60_000),
        db.prepare("DELETE FROM match_queue WHERE last_seen < ? AND room_id IS NULL").bind(now - 60_000),
        db.prepare("DELETE FROM match_queue WHERE player_id = ?").bind(playerId),
        db.prepare(`INSERT INTO players (id, name, rating, wins, losses, created_at, updated_at)
          VALUES (?, ?, ?, 0, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`)
          .bind(playerId, name, startingRating, now, now),
      ]);
      const player = await db
        .prepare("SELECT rating FROM players WHERE id = ?")
        .bind(playerId)
        .first<{ rating: number }>();
      const rating = player?.rating ?? startingRating;
      await db
        .prepare(`INSERT INTO match_queue (player_id, name, rating, joined_at, last_seen, room_id)
          VALUES (?, ?, ?, ?, ?, NULL)
          ON CONFLICT(player_id) DO UPDATE SET
            name = excluded.name,
            rating = excluded.rating,
            joined_at = excluded.joined_at,
            last_seen = excluded.last_seen,
            room_id = NULL`)
        .bind(playerId, name, rating, now, now)
        .run();

      const existing = await db
        .prepare("SELECT room_id FROM match_queue WHERE player_id = ?")
        .bind(playerId)
        .first<{ room_id: string | null }>();
      if (existing?.room_id) {
        return response(await pollRoom(playerId, existing.room_id, 0));
      }

      const roomId = crypto.randomUUID();
      const candidate = await db
        .prepare(`UPDATE match_queue
          SET room_id = ?, last_seen = ?
          WHERE player_id = (
            SELECT player_id FROM match_queue
            WHERE room_id IS NULL AND player_id <> ? AND last_seen > ?
            ORDER BY joined_at ASC LIMIT 1
          ) AND room_id IS NULL
          RETURNING player_id, name, rating`)
        .bind(roomId, now, playerId, now - 60_000)
        .first<{ player_id: string; name: string; rating: number }>();

      if (!candidate) return response({ state: "waiting" });

      const ownClaim = await db
        .prepare("UPDATE match_queue SET room_id = ?, last_seen = ? WHERE player_id = ? AND room_id IS NULL")
        .bind(roomId, now, playerId)
        .run();
      if (!ownClaim.meta?.changes) {
        await db.prepare("UPDATE match_queue SET room_id = NULL WHERE player_id = ? AND room_id = ?").bind(candidate.player_id, roomId).run();
        return response(await pollRoom(playerId, null, 0));
      }

      await db
        .prepare(`INSERT INTO rooms (
          id, player1_id, player2_id, prompt_index, status, player1_ready, player2_ready,
          starts_at, player1_score, player2_score, rated, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'matched', 0, 0, NULL, NULL, NULL, 0, ?, ?)`)
        .bind(
          roomId,
          candidate.player_id,
          playerId,
          crypto.getRandomValues(new Uint32Array(1))[0] % barkPrompts.length,
          now,
          now,
        )
        .run();
      return response(await pollRoom(playerId, roomId, 0));
    }

    const roomId = payload.roomId;
    if (!validRoom(roomId)) return response({ error: "Invalid room." }, 400);
    const room = await getRoom(roomId);
    if (!room || (room.player1_id !== playerId && room.player2_id !== playerId)) {
      return response({ error: "Room not found." }, 404);
    }
    const isPlayer1 = room.player1_id === playerId;

    if (action === "signal") {
      const serialized = JSON.stringify(payload.signal ?? null);
      if (serialized.length > 80_000) return response({ error: "Signal too large." }, 413);
      const recipientId = isPlayer1 ? room.player2_id : room.player1_id;
      const result = await db
        .prepare("INSERT INTO signals (room_id, sender_id, recipient_id, payload, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(roomId, playerId, recipientId, serialized, now)
        .run();
      return response({ ok: result.success });
    }

    if (action === "connected" || action === "ready") {
      const field = isPlayer1 ? "player1_ready" : "player2_ready";
      await db
        .prepare(`UPDATE rooms SET ${field} = 1, updated_at = ? WHERE id = ? AND status = 'matched'`)
        .bind(now, roomId)
        .run();
      return response({ ok: true });
    }

    if (action === "score") {
      const features = parseBarkFeatures(payload.features);
      if (!features) return response({ error: "Invalid audio features." }, 400);
      const score = scoreBark(features, room.prompt_index);
      const field = isPlayer1 ? "player1_score" : "player2_score";
      await db
        .prepare(`UPDATE rooms SET ${field} = COALESCE(${field}, ?), status = 'judging', updated_at = ? WHERE id = ?`)
        .bind(JSON.stringify(score), now, roomId)
        .run();
      return response({ ok: true });
    }

    if (action === "leave") {
      await db.batch([
        db.prepare("DELETE FROM match_queue WHERE player_id = ? AND room_id = ?").bind(playerId, roomId),
        db.prepare("DELETE FROM signals WHERE room_id = ?").bind(roomId),
        db.prepare("UPDATE rooms SET status = CASE WHEN status = 'complete' THEN status ELSE 'abandoned' END, updated_at = ? WHERE id = ?")
          .bind(now, roomId),
      ]);
      return response({ ok: true });
    }

    return response({ error: "Unknown arena action." }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Arena unavailable." }, 500);
  }
}
