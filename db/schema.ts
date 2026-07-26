import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    rating: integer("rating").notNull().default(1200),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("players_rating_idx").on(table.rating)],
);

export const matchQueue = sqliteTable(
  "match_queue",
  {
    playerId: text("player_id").primaryKey(),
    name: text("name").notNull(),
    rating: integer("rating").notNull(),
    joinedAt: integer("joined_at").notNull(),
    lastSeen: integer("last_seen").notNull(),
    roomId: text("room_id"),
  },
  (table) => [
    index("match_queue_waiting_idx").on(table.roomId, table.joinedAt),
    index("match_queue_seen_idx").on(table.lastSeen),
  ],
);

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    player1Id: text("player1_id").notNull(),
    player2Id: text("player2_id").notNull(),
    promptIndex: integer("prompt_index").notNull(),
    status: text("status").notNull().default("matched"),
    player1Ready: integer("player1_ready").notNull().default(0),
    player2Ready: integer("player2_ready").notNull().default(0),
    startsAt: integer("starts_at"),
    player1Score: text("player1_score"),
    player2Score: text("player2_score"),
    rated: integer("rated").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("rooms_player1_idx").on(table.player1Id, table.status),
    index("rooms_player2_idx").on(table.player2Id, table.status),
    index("rooms_created_idx").on(table.createdAt),
  ],
);

export const signals = sqliteTable(
  "signals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: text("room_id").notNull(),
    senderId: text("sender_id").notNull(),
    recipientId: text("recipient_id").notNull(),
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("signals_recipient_idx").on(table.roomId, table.recipientId, table.id),
    index("signals_created_idx").on(table.createdAt),
  ],
);

export const turnGrants = sqliteTable(
  "turn_grants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: text("room_id").notNull(),
    playerId: text("player_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("turn_grants_player_idx").on(table.playerId, table.createdAt),
    index("turn_grants_created_idx").on(table.createdAt),
  ],
);
