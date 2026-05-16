'use strict';

const fs = require('fs');
const { createSolanaRpc, address } = require('@solana/kit');
const { KaminoMarket } = require('@kamino-finance/klend-sdk');

// --- config ---
const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
// Minimum available liquidity (in debt-token units) that counts as "available".
// 0 = alert on any positive amount. Raise it to ignore dust.
const THRESHOLD = Number(process.env.THRESHOLD || '0');
const STATE_FILE = process.env.STATE_FILE || 'state.json';

const MARKET = address('47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8'); // OnRe Market
const COLL = address('6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ');   // ONyc collateral reserve

const PAIRS = [
  {
    name: 'ONyc/USDG Multiply',
    debt: address('JBmLCoKqjdKSStK45onRqe6U6sxVgSpdXoeXe4h7NwJw'),
    url: 'https://kamino.com/multiply/47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8/6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ/JBmLCoKqjdKSStK45onRqe6U6sxVgSpdXoeXe4h7NwJw',
  },
  {
    name: 'ONyc/USDC Multiply',
    debt: address('AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z'),
    url: 'https://kamino.com/multiply/47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8/6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ/AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z',
  },
];

function fmt(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram API error ${res.status}: ${await res.text()}`);
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
  }

  const rpc = createSolanaRpc(RPC);
  const market = await KaminoMarket.load(rpc, MARKET, 450);
  if (!market) throw new Error(`Could not load Kamino market ${MARKET}`);
  await market.loadReserves();

  const collReserve = market.getReserveByAddress(COLL);
  if (!collReserve) throw new Error(`Collateral reserve ${COLL} not found in market`);

  const prevState = loadState();
  const nextState = {};

  for (const pair of PAIRS) {
    const debtReserve = market.getReserveByAddress(pair.debt);
    if (!debtReserve) throw new Error(`Debt reserve ${pair.debt} not found in market`);

    const decimals = debtReserve.stats.decimals;
    const symbol = debtReserve.symbol;

    // Cross-mode (elevation group 0) availability — matches the "Liquidity Available"
    // figure on the Kamino multiply Overview tab. Returns one entry per elevation group.
    const availArr = debtReserve.getLiquidityAvailableForDebtReserveGivenCaps(
      market,
      [0],
      [collReserve.address],
    );
    const availableTokens = (availArr.length ? availArr[0] : null);
    const available = availableTokens
      ? availableTokens.div(10 ** decimals).toNumber()
      : 0;

    const utilization = Number(debtReserve.calculateUtilizationRatio());

    const isOpen = available > THRESHOLD;
    const wasOpen = prevState[pair.name]?.open === true;

    nextState[pair.name] = {
      open: isOpen,
      available,
      symbol,
      utilizationPct: Number((utilization * 100).toFixed(2)),
      checkedAt: new Date().toISOString(),
    };

    console.log(
      `${pair.name}: available=${available.toFixed(2)} ${symbol} ` +
      `util=${(utilization * 100).toFixed(2)}% open=${isOpen} (was ${wasOpen})`,
    );

    if (isOpen && !wasOpen) {
      await sendTelegram(
        `🟢 <b>${pair.name}</b>\n` +
        `Borrow liquidity is now <b>available</b>: <b>${fmt(available)} ${symbol}</b>\n` +
        `Utilization: ${(utilization * 100).toFixed(2)}%\n` +
        `<a href="${pair.url}">Open position on Kamino</a>`,
      );
      console.log(`  -> sent OPEN alert for ${pair.name}`);
    } else if (!isOpen && wasOpen) {
      await sendTelegram(
        `🔴 <b>${pair.name}</b>\n` +
        `Borrow liquidity is closed again (utilization ${(utilization * 100).toFixed(2)}%).`,
      );
      console.log(`  -> sent CLOSED alert for ${pair.name}`);
    }
  }

  saveState(nextState);
}

main().catch((err) => {
  console.error('ERROR:', err.stack || err.message);
  process.exit(1);
});
