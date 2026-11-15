import { TelegramApiError, type TelegramClient } from "../telegram/api";

export type Membership = "member" | "absent" | "unknown";

interface ChatMember {
  status: string;
  is_member?: boolean;
}

export async function verifyGroupMembership(api: TelegramClient, chatId: number, userId: number): Promise<Membership> {
  try {
    const member = await api.call<ChatMember>("getChatMember", { chat_id: chatId, user_id: userId });
    if (member.status === "creator" || member.status === "administrator" || member.status === "member") return "member";
    if (member.status === "restricted" && member.is_member !== false) return "member";
    return "absent";
  } catch (error) {
    if (error instanceof TelegramApiError && error.errorCode === 400) return "absent";
    return "unknown";
  }
}
