import { T } from "../database/identifiers";
import type { SqlExecutor } from "../database/executor";

export interface AppSettings {
  courseTitle: string;
  professorName: string;
  bookName: string;
  semesterName: string;
  groupChatId: string;
  sameDayReminderEnabled: boolean;
  timezone: string;
}

const defaults: AppSettings = {
  courseTitle: "بینایی کامپیوتر",
  professorName: "",
  bookName: "",
  semesterName: "",
  groupChatId: "",
  sameDayReminderEnabled: false,
  timezone: "Asia/Tehran",
};

const settingKeys = {
  course_title: "courseTitle",
  professor_name: "professorName",
  book_name: "bookName",
  semester_name: "semesterName",
  group_chat_id: "groupChatId",
  same_day_reminder_enabled: "sameDayReminderEnabled",
  timezone: "timezone",
} as const;

export type SettingKey = keyof typeof settingKeys;

export async function getSettings(db: SqlExecutor): Promise<AppSettings> {
  const rows = await db.all<{ key: string; value: string }>(`SELECT key, value FROM ${T.settings}`);
  const settings = { ...defaults };
  for (const row of rows) {
    const field = settingKeys[row.key as SettingKey];
    if (!field) continue;
    if (field === "sameDayReminderEnabled") settings.sameDayReminderEnabled = row.value === "true";
    else settings[field] = row.value;
  }
  return settings;
}

export async function setSetting(db: SqlExecutor, key: SettingKey, value: string): Promise<void> {
  await db.run(
    `INSERT INTO ${T.settings} (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
