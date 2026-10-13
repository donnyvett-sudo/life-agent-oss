# iPhone automations (iOS Shortcuts)

Three Shortcuts talk to your bot's Edge Functions. Russian originals with more detail: [docs/shortcut-*.md](.).
All of them need two values that **your own bot** gives you: send `/shortcut` to the bot and it replies with
your **URL** (`https://<ref>.supabase.co/functions/v1/...`) and your personal **token**.
The token goes into the `X-Token` header. Treat it like a password: don't share the Shortcut file after
you paste the token into it.

> Server outside your network? If the bot is hosted somewhere your phone reaches only through a VPN
> (or not through one), the Shortcut fails with a network error. Check the VPN first.

## 1. Log an expense by voice (double-tap the back of the phone)

Say "spent 35 on lunch" and a record appears in the bot.

Shortcuts → **+** → name it **Expense**:
1. **Dictate Text** (stop listening: after pause).
2. **Get Contents of URL**: URL `.../functions/v1/quick-entry`, method **POST**, header `X-Token` = your token,
   request body **JSON**, field `text` (Text) = *Dictated Text*.
3. **Get Dictionary Value** `reply` from *Contents of URL*.
4. **Show Notification** with that value.

Run it from: Settings → Accessibility → Touch → **Back Tap** → Double Tap → *Expense*;
or the Action Button (iPhone 15 Pro+); or Siri ("Hey Siri, Expense").
Examples it understands: "taxi 18", "20 dollars subscription", "yesterday taxi 18 and coffee 25", "got salary 3000".
Default currency is CNY (change per user in the Mini App settings).

## 2. Sleep from Apple Health every morning

1. **Find Health Samples**: type *Sleep Analysis*, filter *Start Date* is in the last *18 hours*, sort by Start Date ascending.
2. **Repeat with Each** over the samples. Inside, a **Text** action with three fields joined by `;`:
   `Start Date` (format ISO 8601, include time) `;` `End Date` (ISO 8601, include time) `;` `Value`.
3. After the loop: **Combine Text** over *Repeat Results*, separator *New Line*.
4. **Get Contents of URL**: `.../functions/v1/sleep-webhook`, **POST**, header `X-Token`, JSON field `text` = *Combined Text*.

Run it once by hand and allow Health access for Sleep Analysis. Expected reply: `{"ok":true,"night":"...","asleep":"7 h 10 m"}`.

Automation (Shortcuts → Automation → **+**), run immediately, notifications off:
- **Time of Day** 07:05 daily → Run Shortcut.
- **App → Telegram → Is Opened** → Run Shortcut (fallback: Health is unreadable while the phone is locked,
  so if the morning run got no data, it sends at the next Telegram open).

Troubleshooting: `no sleep samples` means dates are not ISO 8601 or the watch has not synced; `unauthorized` is a wrong token.

## 3. Steps, weight and resting heart rate

Three **Find Health Samples** actions, in this order (the order matters):
1. *Steps*, Calculate **Sum**, Start Date is in *yesterday*, plus **Source is your Apple Watch**
   (iPhone and Watch both record steps; without the source filter they are counted twice).
2. *Resting Heart Rate*, Calculate **Average**, Start Date in the last 7 days, sort by date, limit 1.
3. *Weight*, sort by Start Date latest first, limit 1 (delete this action if you don't track weight).

Then **Get Contents of URL**: `.../functions/v1/body-webhook`, **POST**, header `X-Token`,
JSON (all Text): `dayShift` = `-1`, `steps` = result 1, `restingHr` = result 2, `weightKg` = result 3.
Show the `reply` value as a notification.

Automation: **Time of Day** 08:30 daily → Run Shortcut (later than the morning summary on purpose: the watch
syncs yesterday late). Re-sending the same day is safe, it overwrites. Weight without a watch: just tell the bot `weight 71.4`.

## Why no ready-made `.shortcut` files
The file embeds your token and URL, so a shared file would leak the secret. Build it yourself in ~5 minutes;
iOS also rejects imported Health filters that were set up elsewhere.
