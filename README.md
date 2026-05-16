# Kamino liquidity bot

Telegram alerts when borrow liquidity opens up on two Kamino multiply products:

- **ONyc/USDG Multiply**
- **ONyc/USDC Multiply**

## What it actually monitors

Both products borrow a stablecoin against ONyc collateral in the OnRe market. The
Kamino UI shows **"Liquidity Available"** (Overview tab) / **"Borrow Capacity
Remaining"** (My Position tab), and right now both read `0.00`.

The reason is **not** an empty reserve — there is plenty of cash. Kamino blocks new
borrows once a reserve crosses **90% utilization**, and both reserves are currently
just above that line. When utilization drops back under 90% (someone repays, or
someone supplies more), liquidity becomes available again.

The bot reads the exact same number the website shows, straight from on-chain reserve
state via Kamino's `klend-sdk` — no API key, no wallet address, no scraping. Each run
it checks both reserves and sends a Telegram message **when liquidity transitions from
closed → open** (and a quieter note when it closes again).

## Files

| File | Purpose |
|---|---|
| `monitor.js` | The check: load market, compute available liquidity, alert on change |
| `state.json` | Last known open/closed state — committed back each run so alerts are edge-triggered, not repeated |
| `.github/workflows/monitor.yml` | Runs `monitor.js` every 10 minutes on GitHub Actions |
| `.env.example` | The environment variables the bot reads |

---

## Deployment (GitHub Actions — free, no server)

### 1. Create the Telegram bot

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, follow
   the prompts. It gives you a **bot token** like `123456789:AAE...`.
2. Send any message to your new bot (this lets it message you back).
3. Get your **chat id**: open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and look for
   `"chat":{"id":...}`. That number is your `TELEGRAM_CHAT_ID`.
   - For a group chat: add the bot to the group, post a message, then check
     `getUpdates` — the group id is negative (e.g. `-1001234567890`).

### 2. (Recommended) Get a Solana RPC URL

The bot falls back to the public RPC, but it's rate-limited and occasionally fails.
A free-tier endpoint from [Helius](https://helius.dev),
[Triton](https://triton.one), or [Alchemy](https://alchemy.com) is much more reliable.
You'll use it as the `RPC_URL` secret.

### 3. Push this folder to a GitHub repo

Use a **public** repo — GitHub Actions minutes are unlimited and free for public
repos. (The bot token never lives in the code; it's stored as an encrypted Actions
secret.) A private repo also works but only gets 2000 free Actions-minutes/month —
enough for roughly a check every 20–30 minutes, so widen the cron in
`monitor.yml` if you go private.

```bash
cd kamino-liquidity-bot
git init
git add .
git commit -m "Kamino liquidity bot"
git branch -M main
git remote add origin https://github.com/<you>/kamino-liquidity-bot.git
git push -u origin main
```

### 4. Add the secrets

In the GitHub repo: **Settings → Secrets and variables → Actions**.

Under **Secrets** → *New repository secret*:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the BotFather token |
| `TELEGRAM_CHAT_ID` | your chat id |
| `RPC_URL` | your Solana RPC URL (optional — omit to use the public RPC) |

Optionally, under **Variables** → *New repository variable*:

| Name | Value |
|---|---|
| `THRESHOLD` | minimum available liquidity (in token units) to alert on. Default `0` |

### 5. Enable and test

1. **Settings → Actions → General** → allow workflows, and under *Workflow
   permissions* select **Read and write permissions** (needed so the bot can commit
   `state.json` back).
2. Go to the **Actions** tab → *Kamino liquidity monitor* → **Run workflow** to
   trigger it manually once. Check the logs — you should see the two reserves printed.
   If liquidity is currently closed (the normal case), no message is sent; the run
   just records state.
3. From then on it runs automatically every 10 minutes. Adjust the `cron:` line in
   `monitor.yml` to change the frequency.

---

## Running locally (optional)

```bash
cp .env.example .env      # then fill in the values
npm install
env $(grep -v '^#' .env | xargs) node monitor.js
```

For a long-running local process instead of cron, wrap it in a loop or use a
process manager (pm2, systemd, etc.) — but the GitHub Actions setup above needs no
machine of your own.

## Tuning

- **Frequency** — edit the `cron:` schedule in `monitor.yml`.
- **What counts as "available"** — set the `THRESHOLD` variable to ignore dust
  amounts (e.g. `1000` to only alert when ≥1000 tokens are borrowable).
- **Different products** — edit the `PAIRS` array in `monitor.js`. Each entry needs
  the debt reserve address and the page URL; the market and ONyc collateral reserve
  are already set for the OnRe market.

## Notes / limitations

- GitHub's scheduled runs can be delayed several minutes under load — fine for this
  use case, but don't expect second-level precision.
- `klend-sdk` 7.3.22 ships with a broken transitive dependency; `package.json`
  pins `@kamino-finance/farms-sdk` to `3.2.24` via `overrides` to fix it. Keep that
  pin if you bump versions.
- Alerts are edge-triggered via `state.json`. If you ever want a fresh alert for a
  currently-open reserve, delete its entry from `state.json` and commit.
