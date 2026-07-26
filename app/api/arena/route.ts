import { ensureArenaSchema, getD1 } from "../../../db";
import { env } from "cloudflare:workers";

type Score = {
  total: number;
  power: number;
  control: number;
  character: number;
};

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
};

type SignalRow = {
  id: number;
  payload: string;
};

const ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const ROOM_PATTERN = /^[a-zA-Z0-9-]{20,80}$/;

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

function validId(value: unknown) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function validRoom(value: unknown) {
  return typeof value === "string" && ROOM_PATTERN.test(value);
}

function parseScore(value: unknown): Score | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const number = (key: string) => Math.max(0, Math.min(100, Math.round(Number(record[key]) || 0)));
  return {
    total: number("total"),
    power: number("power"),
    control: number("control"),
    character: number("character"),
  };
}

function safeScore(value: string | null) {
  if (!value) return null;
  try {
    return parseScore(JSON.parse(value));
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
      p2.rating AS player2_rating
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
      const runtime = env as unknown as {
        TURN_KEY_ID?: string;
        TURN_KEY_API_TOKEN?: string;
      };
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
            return response({ iceServers: credentials.iceServers, relay: true });
          }
        }
      }
      return response({
        iceServers: [
          { urls: "stun:stun.cloudflare.com:3478" },
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
        ],
        relay: false,
      });
    }

    if (action === "leaderboard") {
      const rows = await db
        .prepare("SELECT name, rating, wins, losses FROM players WHERE wins + losses > 0 ORDER BY rating DESC, wins DESC LIMIT 12")
        .all<{ name: string; rating: number; wins: number; losses: number }>();
      return response({ players: rows.results });
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

    if (action === "match") {
      const name = cleanName(payload.name);
      const startingRating = 1200;
      await db.batch([
        db.prepare("DELETE FROM signals WHERE created_at < ?").bind(now - 10 * 60_000),
        db.prepare("DELETE FROM match_queue WHERE last_seen < ? AND room_id IS NULL").bind(now - 60_000),
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
          ON CONFLICT(player_id) DO UPDATE SET name = excluded.name, rating = excluded.rating, last_seen = excluded.last_seen`)
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
        .bind(roomId, candidate.player_id, playerId, crypto.getRandomValues(new Uint32Array(1))[0] % 6, now, now)
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

    if (action === "ready") {
      const field = isPlayer1 ? "player1_ready" : "player2_ready";
      await db.prepare(`UPDATE rooms SET ${field} = 1, updated_at = ? WHERE id = ?`).bind(now, roomId).run();
      return response({ ok: true });
    }

    if (action === "score") {
      const score = parseScore(payload.score);
      if (!score) return response({ error: "Invalid score." }, 400);
      const field = isPlayer1 ? "player1_score" : "player2_score";
      await db
        .prepare(`UPDATE rooms SET ${field} = COALESCE(${field}, ?), status = 'judging', updated_at = ? WHERE id = ?`)
        .bind(JSON.stringify(score), now, roomId)
        .run();
      return response({ ok: true });
    }

    if (action === "leave") {
      await db.batch([
        db.prepare("DELETE FROM match_queue WHERE player_id = ?").bind(playerId),
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
