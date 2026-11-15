const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const baseUrl = process.env.WEBHOOK_URL;

if (!token || !secret || !baseUrl) {
  console.error("BOT_TOKEN، WEBHOOK_SECRET و WEBHOOK_URL لازم هستند.");
  process.exit(1);
}

if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
  console.error("WEBHOOK_SECRET باید ۱۶ تا ۲۵۶ نویسه از حروف، عدد، _ یا - باشد.");
  process.exit(1);
}

const endpoint = new URL("/webhook", baseUrl).href;
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: endpoint,
    secret_token: secret,
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    drop_pending_updates: false,
  }),
});

const payload = await response.json();
if (!payload.ok) {
  console.error(`تنظیم وب‌هوک ناموفق بود: ${payload.description ?? "unknown"}`);
  process.exit(1);
}

console.log(`وب‌هوک ثبت شد: ${endpoint}`);
