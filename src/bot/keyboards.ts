import { InlineKeyboard } from "grammy";

export function mainMenu(isAdminUser: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📚 مشاهده برنامه ارائه‌ها", "m:sch")
    .row()
    .text("📝 ثبت‌نام برای ارائه", "m:reg")
    .row()
    .text("👥 مشاهده گروه‌های ارائه", "m:teams")
    .row()
    .text("📅 ارائه‌های من", "m:mine")
    .row()
    .text("❌ لغو ثبت‌نام", "m:unreg")
    .row()
    .text("ℹ️ راهنما", "m:help");
  if (isAdminUser) keyboard.row().text("🛠 مدیریت کلاس", "a:home");
  return keyboard;
}

export function backHome(): InlineKeyboard {
  return new InlineKeyboard().text("بازگشت به منو", "m:home");
}

export function confirmRegistration(chapterId: number): InlineKeyboard {
  return new InlineKeyboard().text("✅ تأیید ثبت‌نام", `y:${chapterId}`).row().text("بازگشت", "m:reg");
}

export function confirmCancel(): InlineKeyboard {
  return new InlineKeyboard().text("بله، لغو شود", "u:yes").row().text("انصراف", "m:mine");
}

export function adminMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ افزودن فصل", "a:add")
    .row()
    .text("📋 مدیریت فصل‌ها", "a:chapters")
    .row()
    .text("👥 دانشجویان", "a:students")
    .row()
    .text("📊 آمار", "a:stats")
    .row()
    .text("⚙️ تنظیمات ترم", "a:settings")
    .row()
    .text("📢 به‌روزرسانی پیام گروه", "a:publish")
    .row()
    .text("👤 منوی دانشجو", "m:home");
}

export function chapterAdminKeyboard(id: number, open: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text("ویرایش عنوان", `t:${id}`)
    .row()
    .text("تنظیم تاریخ", `d:${id}`)
    .text("تنظیم ساعت", `i:${id}`)
    .row()
    .text(open ? "بستن ثبت‌نام" : "باز کردن ثبت‌نام", `o:${id}`)
    .row()
    .text("اعضای گروه", `p:${id}`)
    .row()
    .text("افزودن با شناسه", `s:${id}`)
    .row()
    .text("برگزار شد", `g:${id}:done`)
    .text("بازگشت به برنامه", `g:${id}:sched`)
    .row()
    .text("لغو ارائه", `x:${id}`)
    .row()
    .text("بازگشت", "a:chapters");
}

export function promptKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("انصراف", "a:clear");
}

export function settingsKeyboard(sameDay: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text("نام درس", "w:course")
    .text("استاد", "w:prof")
    .row()
    .text("کتاب", "w:book")
    .text("ترم", "w:sem")
    .row()
    .text("شناسه گروه", "w:group")
    .row()
    .text(sameDay ? "خاموش کردن یادآوری روز ارائه" : "فعال کردن یادآوری روز ارائه", "a:sameday")
    .row()
    .text("بازگشت", "a:home");
}
