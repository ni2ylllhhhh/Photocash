# 🚀 PhotoCash Cloudflare Telegram Bot & Verification Server Setup

এই বটের কোড সম্পূর্ণভাবে **Cloudflare Pages** এবং **Cloudflare Workers**-এ ২৪ ঘণ্টা ফ্রিতে হোস্ট করার জন্য তৈরি করা হয়েছে।

---

## 📁 তৈরি করা ফাইলসমূহ:
1. `functions/api/bot.js` — Cloudflare Pages Function (টেলিগ্রাম ওয়েবহুক হ্যান্ডলার)
2. `functions/api/verify.js` — Cloudflare Pages Function (চ্যানেল ভেরিফিকেশন API)
3. `cloudflare-bot/worker.js` — সম্পূর্ণ সেলফ-কন্টেইন্ড Cloudflare Worker স্ক্রিপ্ট
4. `cloudflare-bot/wrangler.toml` — ১-ক্লিকে `npx wrangler deploy` করার কনফিগ

---

## 🛠️ হোস্ট করার সহজ নিয়ম:

### পদ্ধতি ১: Cloudflare Pages (সবচেয়ে সহজ - জিরো কনফিগ)
আপনার এই পুরো গিটহাব (GitHub) রিপোজিটরি সরাসরি **Cloudflare Pages**-এ কানেক্ট করে ডিপ্লয় করলে:
- ফ্রন্টএন্ড ওয়েবসাইট হোস্ট হয়ে যাবে।
- রুট ডিরেক্টরির `/functions/api/bot.js` এবং `/functions/api/verify.js` স্বয়ংক্রিয়ভাবে ক্লাউডফেয়ার ফাংশন হিসেবে চালু হয়ে যাবে!
- টেলিগ্রাম ওয়েবহুক সেট করতে শুধু আপনার সাইটের URL দিয়ে এই লিংকে ব্রাউজারে যাবেন:
  `https://your-domain.pages.dev/api/bot`
  অথবা `cloudflare-bot/worker.js` এর মেথড ব্যবহার করতে পারেন।

---

### পদ্ধতি ২: Cloudflare Workers (১-ক্লিক ফ্রি ডিপ্লয়)
১. [Cloudflare Dashboard](https://dash.cloudflare.com/) এ গিয়ে **Workers & Pages** এ যান।
২. **Create Application** -> **Create Worker** বাটনে ক্লিক করুন।
৩. Worker-এর ভেতরে **Quick Edit** এ গিয়ে `cloudflare-bot/worker.js` এর পুরো কোড পেস্ট করে **Save and Deploy** দিন।
৪. আপনার Worker এর লিংক পাবেন (যেমন: `https://photocash-bot.yourname.workers.dev`)।
৫. ব্রাউজারে সেই লিংকের পেছনে `/setWebhook` লিখে ভিজিট করুন:
   `https://photocash-bot.yourname.workers.dev/setWebhook`
   এটি সাথে সাথে টেলিগ্রামের সাথে ওয়েবহুক কানেক্ট করে দিবে!

---

## 🤖 বট কি কি কাজ করবে:
1. **স্বয়ংক্রিয় চ্যানেল ভেরিফিকেশন**: ইউজার চ্যানেলে জয়েন আছে কিনা (`getChatMember`) তা ২৪ ঘণ্টা ক্লাউডফেয়ারের হাই-স্পিড এজ সার্ভার থেকে যাচাই করবে।
2. **/start কমান্ড**: নতুন ইউজারকে বোনাস দিবে, রেফারেল ট্র্যাক করবে এবং চ্যানেলগুলোতে জয়েন না থাকলে `[ 📢 Join Channel ]` ও `[ ✅ Verify Membership ]` বাটন দেখাবে।
3. **ইনলাইন ভেরিফাই বাটন**: ইউজার টেলিগ্রামে `[ ✅ Verify Membership ]` বাটনে চাপলে সাথে সাথে চেক করে Firebase ডাটাবেজে `channelsVerified: true` করে দিবে এবং `[ 📸 Open PhotoCash ]` বাটন পাঠিয়ে দিবে।
4. **CORS-Free API**: ওয়েব অ্যাপের জন্য `/api/verify?user_id=...` এন্ডপয়েন্ট থাকবে যা কোনো বাধা ছাড়াই চ্যানেল ভেরিফাই করতে পারে।
