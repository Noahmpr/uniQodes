import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: integer("telegram_id").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  username: text("username"),
  isActive: integer("is_active").notNull().default(1),
  hasStartedBot: integer("has_started_bot").notNull().default(0),
  blockedBot: integer("blocked_bot").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chapters = sqliteTable("chapters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chapterNumber: integer("chapter_number").notNull().unique(),
  title: text("title").notNull(),
  presentationDate: text("presentation_date"),
  presentationTime: text("presentation_time"),
  registrationOpen: integer("registration_open").notNull().default(1),
  closedBy: text("closed_by"),
  status: text("status").notNull().default("scheduled"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const registrations = sqliteTable("registrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique(),
  chapterId: integer("chapter_id").notNull(),
  registeredAt: text("registered_at").notNull(),
});

export const telegramMessages = sqliteTable("telegram_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id").notNull(),
  messageId: integer("message_id").notNull(),
  messageType: text("message_type").notNull().unique(),
  updatedAt: text("updated_at").notNull(),
});

export const reminderLogs = sqliteTable("reminder_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  chapterId: integer("chapter_id").notNull(),
  reminderType: text("reminder_type").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  sentAt: text("sent_at"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextRetryAt: text("next_retry_at"),
  claimedAt: text("claimed_at"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sessions = sqliteTable("sessions", {
  telegramId: integer("telegram_id").primaryKey(),
  state: text("state").notNull(),
  payload: text("payload").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});
