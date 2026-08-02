const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : __dirname;

app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
  const indexPath = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
    ? path.join(__dirname, 'public', 'index.html')
    : path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Binance Stock Meme Tracker Server is Running!');
  }
});

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Configuration Store
let config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '8008965071:AAFGBtu2hsZOswE3bq6A3SDDl_mJFJivJ9M',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '1581324942',
  telegramEnabled: true,
  basedBotUrlTemplate: 'https://t.me/based_eth_bot?start={ca}'
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const loaded = JSON.parse(data);
      config = { ...config, ...loaded };
    }
  } catch (err) {
    console.error('[CONFIG] Error loading config.json:', err.message);
  }
  // Ensure valid credentials even if config.json on disk is missing or empty
  if (!config.telegramBotToken) config.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '8008965071:AAFGBtu2hsZOswE3bq6A3SDDl_mJFJivJ9M';
  if (!config.telegramChatId) config.telegramChatId = process.env.TELEGRAM_CHAT_ID || '1581324942';
  console.log(`[CONFIG] Loaded config (Telegram Enabled: ${config.telegramEnabled && Boolean(config.telegramBotToken)})`);
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[CONFIG] Error saving config.json:', err.message);
  }
}

// In-Memory Storage
let activeTokensMap = new Map();      // key: `${chain}_${contractAddress}`
let knownTokensMemory = new Set();    // All unique keys ever seen (persists across session via events scan)
let removedTokensMemory = new Map();  // key -> { removedAt: timestamp } for tokens that were removed
let missingTicksMap = new Map();      // key -> count of consecutive missed polls
let eventsHistory = [];
let sseClients = [];
let lastPollTime = null;
let pollIntervalMs = 4000; // 4 seconds ultra-fast poll
let isPolling = false;
let isInitialRun = true;

const MAX_MISSING_TICKS = 3; // Require 3 consecutive valid missed polls (~12 seconds) before declaring REMOVED

// Supported Chains Config
const CHAINS = [
  { id: '56', name: 'BSC', key: 'bsc', referer: 'https://web3.binance.com/en/markets/stock-meme-coins?chain=bsc' },
  { id: '4663', name: 'Robinhood', key: 'robinhood', referer: 'https://web3.binance.com/en/markets/stock-meme-coins?chain=robinhood' }
];

// Load persisted data if available
function loadPersistedData() {
  loadConfig();

  try {
    if (fs.existsSync(EVENTS_FILE)) {
      const data = fs.readFileSync(EVENTS_FILE, 'utf8');
      eventsHistory = JSON.parse(data);
      console.log(`[DATA] Loaded ${eventsHistory.length} historical events from disk.`);

      // Rebuild knownTokensMemory and removedTokensMemory from event history
      // Process events from oldest to newest (they are stored newest-first)
      const reversedEvents = [...eventsHistory].reverse();
      for (const evt of reversedEvents) {
        if (evt.contractAddress) {
          const chainKey = evt.chainName ? evt.chainName.toLowerCase() : (evt.chainId === '4663' ? 'robinhood' : 'bsc');
          const uniqueKey = `${chainKey}_${evt.contractAddress.toLowerCase()}`;
          if (evt.type === 'ADDED' || evt.type === 'RE_ADDED') {
            knownTokensMemory.add(uniqueKey);
            removedTokensMemory.delete(uniqueKey);
          } else if (evt.type === 'REMOVED') {
            removedTokensMemory.set(uniqueKey, { removedAt: evt.timestamp });
          }
        }
      }
      console.log(`[DATA] Rebuilt knownTokensMemory: ${knownTokensMemory.size} tokens, removedTokensMemory: ${removedTokensMemory.size} tokens.`);
    }
  } catch (err) {
    console.error('[DATA] Error loading events.json:', err.message);
  }

  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const data = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
      const savedTokens = JSON.parse(data);
      savedTokens.forEach(token => {
        if (token.contractAddress) {
          const chainKey = token.chainName ? token.chainName.toLowerCase() : (token.chainId === '4663' ? 'robinhood' : 'bsc');
          const uniqueKey = `${chainKey}_${token.contractAddress.toLowerCase()}`;
          activeTokensMap.set(uniqueKey, token);
          knownTokensMemory.add(uniqueKey);
        }
      });
      console.log(`[DATA] Loaded ${activeTokensMap.size} active tokens snapshot from disk.`);
    }
  } catch (err) {
    console.error('[DATA] Error loading snapshot.json:', err.message);
  }
}

function saveData() {
  try {
    const tokensArray = Array.from(activeTokensMap.values());
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(tokensArray, null, 2));
    fs.writeFileSync(EVENTS_FILE, JSON.stringify(eventsHistory, null, 2));
  } catch (err) {
    console.error('[DATA] Error saving data to disk:', err.message);
  }
}

// Fetch Binance Web3 API for a specific chain
function fetchChainStockMemes(chainConfig) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      rankType: 60,
      period: 30,
      chainId: chainConfig.id,
      tabId: 61,
      size: 100
    });

    const options = {
      hostname: 'web3.binance.com',
      port: 443,
      path: '/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'clienttype': 'web',
        'clientVersion': '1.3.0',
        'webdexClientVersion': '1.3.0',
        'lang': 'en',
        'Referer': chainConfig.referer
      },
      timeout: 6000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
          }
          const parsed = JSON.parse(body);
          if (parsed.code !== '000000') {
            return reject(new Error(`BAPI error code: ${parsed.code}`));
          }
          const rawTokens = parsed.data?.tokens || [];
          resolve({ chain: chainConfig, tokens: rawTokens });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Binance BAPI Request Timeout for ${chainConfig.name}`));
    });

    req.write(postData);
    req.end();
  });
}

function formatCurrency(val) {
  if (val === null || val === undefined || isNaN(val) || val === 0) return '$0.00';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(2)}K`;
  if (val < 0.0001) return `$${val.toFixed(6)}`;
  return `$${val.toFixed(4)}`;
}

function formatTokenAge(launchTime) {
  if (!launchTime) return '1d';
  const diffMs = Date.now() - launchTime;
  if (diffMs <= 0) return '1m';
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

// In-memory deduplication map for Telegram notifications (prevents duplicate messages within 60s)
const sentTelegramEventsMap = new Map();

// Send Telegram Notification with Native Inline Keyboard Buttons
function sendTelegramNotification(evt) {
  if (!config.telegramEnabled || !config.telegramBotToken || !config.telegramChatId) return;

  const caLower = (evt.contractAddress || '').toLowerCase();
  const eventKey = `${evt.type}_${evt.chainId || '56'}_${caLower}`;
  const lastSent = sentTelegramEventsMap.get(eventKey);
  if (lastSent && (Date.now() - lastSent < 60000)) {
    console.log(`[TELEGRAM SKIP] Duplicate notification ${eventKey} skipped (sent ${Math.round((Date.now() - lastSent)/1000)}s ago)`);
    return;
  }
  sentTelegramEventsMap.set(eventKey, Date.now());

  const chainName = evt.chainName || (evt.chainId === '4663' ? 'Robinhood' : 'BSC');
  const gmgnUrl = `https://gmgn.ai/bsc/token/${caLower}`;
  const template = config.basedBotUrlTemplate || 'https://t.me/based_eth_bot?start={ca}';
  const basedBotUrl = template.replace('{ca}', caLower);
  const tokenAge = formatTokenAge(evt.launchTime);

  const mcFormatted = evt.marketCap ? formatCurrency(evt.marketCap) : '-';
  const liqFormatted = evt.liquidity ? formatCurrency(evt.liquidity) : '-';
  const holdersFormatted = evt.holders ? evt.holders.toLocaleString() : '-';

  // Strict Social Links - Only show if Binance provided valid URL
  const socials = [];
  if (isValidUrl(evt.website)) socials.push(`<a href="${evt.website}">🌐 Website</a>`);
  if (isValidUrl(evt.twitter)) socials.push(`<a href="${evt.twitter}">𝕏 Twitter</a>`);
  if (isValidUrl(evt.telegram)) socials.push(`<a href="${evt.telegram}">✈️ Telegram</a>`);
  const socialStr = socials.length > 0 ? socials.join(' | ') : '';

  let headerEmoji = '🟢';
  let headerText = 'YENİ EKLENDİ';
  if (evt.type === 'RE_ADDED') {
    headerEmoji = '🔄';
    headerText = 'TEKRAR EKLENDİ';
  } else if (evt.type === 'REMOVED') {
    headerEmoji = '🔴';
    headerText = 'ÇIKARILDI';
  }

  let message = `${headerEmoji} <b>${headerText} [${chainName}]</b>\n\n` +
                `<b>Coin:</b> $${evt.symbol} (${evt.name})\n` +
                `<b>Yaş:</b> <code>${tokenAge}</code>\n` +
                `<b>Market Cap:</b> <code>${mcFormatted}</code>\n` +
                `<b>Likitide:</b> <code>${liqFormatted}</code>\n` +
                `<b>Holders:</b> <code>${holdersFormatted}</code>\n` +
                `<b>CA:</b> <code>${evt.contractAddress}</code>\n`;

  if (socialStr) {
    message += `<b>Sosyal:</b> ${socialStr}\n`;
  }

  // Native Telegram Inline Keyboard Buttons (separate buttons below the message)
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🤖 Basedbot ↗', url: basedBotUrl },
        { text: '🦖 GMGN ↗', url: gmgnUrl }
      ]
    ]
  };

  const postData = JSON.stringify({
    chat_id: config.telegramChatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: evt.type !== 'REMOVED' ? replyMarkup : undefined
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${config.telegramBotToken}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 5000
  };

  const req = https.request(options, (res) => {
    let responseBody = '';
    res.on('data', chunk => responseBody += chunk);
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.error(`[TELEGRAM ERROR] HTTP ${res.statusCode}:`, responseBody);
      } else {
        console.log(`[TELEGRAM SENT] ${evt.type} notification with Inline Buttons sent for $${evt.symbol}`);
      }
    });
  });

  req.on('error', (err) => {
    console.error('[TELEGRAM ERROR]', err.message);
  });

  req.write(postData);
  req.end();
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function extractSocials(raw) {
  let website = null;
  let twitter = null;
  let telegram = null;

  // 1. Primary: Binance Web3 previewLink structure
  if (raw.previewLink && typeof raw.previewLink === 'object') {
    if (Array.isArray(raw.previewLink.website) && raw.previewLink.website.length > 0) {
      const candidate = raw.previewLink.website[0];
      if (isValidUrl(candidate)) website = candidate.trim();
    }
    if (Array.isArray(raw.previewLink.x) && raw.previewLink.x.length > 0) {
      const candidate = raw.previewLink.x[0];
      if (isValidUrl(candidate)) twitter = candidate.trim();
    }
    if (Array.isArray(raw.previewLink.telegram) && raw.previewLink.telegram.length > 0) {
      const candidate = raw.previewLink.telegram[0];
      if (isValidUrl(candidate)) telegram = candidate.trim();
    }
  }

  // 2. Secondary: Binance Web3 links array
  if (Array.isArray(raw.links)) {
    raw.links.forEach(l => {
      const label = (l.label || '').toLowerCase();
      const url = (l.link || '').trim();
      if (isValidUrl(url)) {
        if (!twitter && (label === 'x' || label.includes('twitter'))) {
          twitter = url;
        } else if (!website && (label.includes('website') || label.includes('site') || label.includes('web'))) {
          website = url;
        } else if (!telegram && (label.includes('telegram') || label.includes('tg'))) {
          telegram = url;
        }
      }
    });
  }

  return { website, twitter, telegram };
}

// Format Token
function formatToken(raw, chainConfig) {
  const meta = raw.metaInfo || {};
  const socials = extractSocials(raw);
  const launchTs = raw.launchTime ? parseInt(raw.launchTime, 10) : (meta.createTime ? parseInt(meta.createTime, 10) : null);

  return {
    contractAddress: raw.contractAddress,
    chainId: chainConfig.id,
    chainName: chainConfig.name,
    symbol: meta.originSymbol || meta.name || raw.symbol || "UNKNOWN",
    name: meta.originName || meta.name || raw.name || "Unknown Token",
    icon: meta.icon ? (meta.icon.startsWith('http') ? meta.icon : `https://bin.bnbstatic.com${meta.icon}`) : null,
    price: parseFloat(raw.price || 0),
    percentChange5m: parseFloat(raw.percentChange5m || 0),
    percentChange1h: parseFloat(raw.percentChange1h || 0),
    percentChange4h: parseFloat(raw.percentChange4h || 0),
    percentChange24h: parseFloat(raw.percentChange24h || 0),
    volume24h: parseFloat(raw.volume24h || 0),
    liquidity: parseFloat(raw.liquidity || 0),
    marketCap: parseFloat(raw.marketCap || 0),
    holders: parseInt(raw.holders || 0, 10),
    kycHolders: parseInt(raw.kycHolders || 0, 10),
    launchTime: launchTs,
    firstSeenTime: raw.firstSeenTime || Date.now(),
    lastSeenTime: Date.now(),
    tags: raw.tokenTag || {},
    smartMoneyHoldingPercent: raw.smartMoneyHoldingPercent || 0,
    kolHoldingPercent: raw.kolHoldingPercent || 0,
    creatorAddress: meta.creatorAddress || null,
    website: socials.website,
    twitter: socials.twitter,
    telegram: socials.telegram
  };
}

// Guaranteed 100% Reliable ADDED Event Engine
async function pollBinance() {
  if (isPolling) return;
  isPolling = true;

  try {
    const results = await Promise.allSettled(CHAINS.map(c => fetchChainStockMemes(c)));
    lastPollTime = Date.now();

    const currentMap = new Map();
    const successfulChainKeys = new Set();

    results.forEach(res => {
      if (res.status === 'fulfilled') {
        const { chain, tokens } = res.value;
        successfulChainKeys.add(chain.key);

        tokens.forEach(rt => {
          const formatted = formatToken(rt, chain);
          if (formatted.contractAddress) {
            const uniqueKey = `${chain.key}_${formatted.contractAddress.toLowerCase()}`;
            currentMap.set(uniqueKey, formatted);
          }
        });
      } else {
        console.error(`[POLL WARNING] BAPI fetch failed: ${res.reason.message}`);
      }
    });

    const newEvents = [];

    // 1. ADDED / RE_ADDED DETECTION
    for (const [key, token] of currentMap.entries()) {
      missingTicksMap.set(key, 0); // Reset miss counter

      if (!activeTokensMap.has(key)) {
        // Token is NOT in current active list
        token.firstSeenTime = Date.now();
        activeTokensMap.set(key, token);

        if (!isInitialRun) {
          // Check if this token was previously removed (RE_ADDED) or truly brand new (ADDED)
          const wasRemoved = removedTokensMemory.has(key);
          const wasSeen = knownTokensMemory.has(key);
          const isReAdd = wasRemoved || wasSeen;

          const removedInfo = removedTokensMemory.get(key);
          const lastRemovedTime = removedInfo ? removedInfo.removedAt : null;

          const eventType = isReAdd ? 'RE_ADDED' : 'ADDED';

          const addEvent = {
            id: `evt_${isReAdd ? 'readd' : 'add'}_${key}_${Date.now()}`,
            type: eventType,
            timestamp: Date.now(),
            contractAddress: token.contractAddress,
            chainId: token.chainId,
            chainName: token.chainName,
            symbol: token.symbol,
            name: token.name,
            icon: token.icon,
            price: token.price,
            marketCap: token.marketCap,
            liquidity: token.liquidity,
            holders: token.holders,
            launchTime: token.launchTime,
            tags: token.tags,
            website: token.website,
            twitter: token.twitter,
            telegram: token.telegram,
            lastRemovedTime: lastRemovedTime
          };
          eventsHistory.unshift(addEvent);
          newEvents.push(addEvent);

          // Clean up removed memory since it's back
          removedTokensMemory.delete(key);

          const emoji = isReAdd ? '🔄' : '🟢';
          const label = isReAdd ? 'RE_ADDED' : 'ADDED';
          console.log(`[${emoji} ${label} EVENT] (${token.chainName}): ${token.symbol} (${token.contractAddress})`);
        }

        // Always mark as known
        knownTokensMemory.add(key);
      } else {
        // Update stats for existing active token
        const existing = activeTokensMap.get(key);
        token.firstSeenTime = existing.firstSeenTime || token.firstSeenTime;
        activeTokensMap.set(key, token);
      }
    }

    // 2. REMOVED DETECTION (3 consecutive missed polls required)
    for (const [key, existingToken] of [...activeTokensMap.entries()]) {
      const chainKey = existingToken.chainName ? existingToken.chainName.toLowerCase() : (existingToken.chainId === '4663' ? 'robinhood' : 'bsc');

      if (successfulChainKeys.has(chainKey) && !currentMap.has(key)) {
        const currentMisses = (missingTicksMap.get(key) || 0) + 1;
        missingTicksMap.set(key, currentMisses);

        if (currentMisses >= MAX_MISSING_TICKS) {
          activeTokensMap.delete(key);
          missingTicksMap.delete(key);

          // Record removal in removedTokensMemory so future re-adds are detected as RE_ADDED
          removedTokensMemory.set(key, { removedAt: Date.now() });

          if (!isInitialRun) {
            const removeEvent = {
              id: `evt_rem_${key}_${Date.now()}`,
              type: 'REMOVED',
              timestamp: Date.now(),
              contractAddress: existingToken.contractAddress,
              chainId: existingToken.chainId,
              chainName: existingToken.chainName,
              symbol: existingToken.symbol,
              name: existingToken.name,
              icon: existingToken.icon,
              lastPrice: existingToken.price,
              marketCap: existingToken.marketCap,
              liquidity: existingToken.liquidity,
              tags: existingToken.tags
            };
            eventsHistory.unshift(removeEvent);
            newEvents.push(removeEvent);
            console.log(`[🔴 REMOVED EVENT] (${existingToken.chainName}): ${existingToken.symbol} (${existingToken.contractAddress})`);
          }
        }
      }
    }

    if (isInitialRun) {
      isInitialRun = false;
      console.log(`[INIT] Initial snapshot locked. Active stock meme coins: ${activeTokensMap.size}`);
    }

    saveData();

    if (newEvents.length > 0) {
      broadcastSSE({
        event: 'NEW_EVENTS',
        data: newEvents
      });

      newEvents.forEach(sendTelegramNotification);
    }

    broadcastSSE({
      event: 'STATUS',
      data: getStats()
    });

  } catch (err) {
    console.error('[POLL CRITICAL ERROR]', err.message);
  } finally {
    isPolling = false;
  }
}

function broadcastSSE(payload) {
  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(client => client.res.write(dataString));
}

function getStats() {
  const now = Date.now();
  const oneDayAgo = now - 86400000;
  const added24h = eventsHistory.filter(e => (e.type === 'ADDED' || e.type === 'RE_ADDED') && e.timestamp >= oneDayAgo).length;
  const removed24h = eventsHistory.filter(e => e.type === 'REMOVED' && e.timestamp >= oneDayAgo).length;

  const tokensArr = Array.from(activeTokensMap.values());
  const bscCount = tokensArr.filter(t => t.chainId === '56').length;
  const robinhoodCount = tokensArr.filter(t => t.chainId === '4663').length;

  return {
    totalActive: activeTokensMap.size,
    bscCount,
    robinhoodCount,
    totalEvents: eventsHistory.length,
    added24h,
    removed24h,
    lastPollTime,
    pollIntervalMs
  };
}

// REST API Endpoints
app.get('/api/tokens', (req, res) => {
  const chain = req.query.chain;
  let tokens = Array.from(activeTokensMap.values());
  if (chain) {
    if (chain.toLowerCase() === 'bsc') {
      tokens = tokens.filter(t => t.chainId === '56');
    } else if (chain.toLowerCase() === 'robinhood') {
      tokens = tokens.filter(t => t.chainId === '4663');
    }
  }

  res.json({
    success: true,
    total: tokens.length,
    data: tokens
  });
});

app.get('/api/events', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const type = req.query.type;
  
  let filtered = eventsHistory;
  if (type) {
    filtered = filtered.filter(e => e.type === type.toUpperCase());
  }

  res.json({
    success: true,
    total: filtered.length,
    data: filtered.slice(0, limit)
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    data: getStats()
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      telegramEnabled: config.telegramEnabled,
      hasBotToken: Boolean(config.telegramBotToken),
      hasChatId: Boolean(config.telegramChatId),
      chatId: config.telegramChatId ? `${config.telegramChatId.substring(0, 3)}***` : ''
    }
  });
});

app.post('/api/config', (req, res) => {
  const { telegramBotToken, telegramChatId, telegramEnabled } = req.body;

  if (telegramBotToken !== undefined) config.telegramBotToken = telegramBotToken.trim();
  if (telegramChatId !== undefined) config.telegramChatId = telegramChatId.toString().trim();
  if (telegramEnabled !== undefined) config.telegramEnabled = Boolean(telegramEnabled);

  saveConfig();

  // Send test message if credentials provided
  if (config.telegramBotToken && config.telegramChatId) {
    sendTelegramNotification({
      type: 'ADDED',
      symbol: 'TEST',
      name: 'Binance Meme Tracker Telegram Bağlantısı Başarılı!',
      chainName: 'BSC',
      chainId: '56',
      contractAddress: '0x0000000000000000000000000000000000000000',
      marketCap: 1234567
    });
  }

  res.json({
    success: true,
    message: 'Configuration updated successfully!',
    data: {
      telegramEnabled: config.telegramEnabled,
      hasBotToken: Boolean(config.telegramBotToken),
      hasChatId: Boolean(config.telegramChatId)
    }
  });
});

app.post('/api/poll', async (req, res) => {
  await pollBinance();
  res.json({ success: true, message: 'Poll triggered', data: getStats() });
});

// SSE Endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  newClient.res.write(`data: ${JSON.stringify({
    event: 'INITIAL_STATE',
    data: {
      tokens: Array.from(activeTokensMap.values()),
      events: eventsHistory.slice(0, 50),
      stats: getStats()
    }
  })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// Initialize and start server
loadPersistedData();

pollBinance().then(() => {
  console.log(`[INIT] Initial snapshot locked. Active stock meme coins: ${activeTokensMap.size}`);
});

setInterval(pollBinance, pollIntervalMs);

// 24/7 Keep-Alive Self-Ping Engine (Prevents Render Free Tier Sleeping)
setInterval(() => {
  const pingUrl = process.env.RENDER_EXTERNAL_URL || 'https://binance-stock-meme-tracker.onrender.com';
  https.get(`${pingUrl}/api/stats`, (res) => {
    // Keep-alive ping successful
  }).on('error', (err) => {
    // Ignore ping errors
  });
}, 4 * 60 * 1000); // Ping every 4 minutes

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Binance Web3 Stock Meme Tracker (Guaranteed ADDED Event Engine)!`);
  console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
  console.log(`📡 SSE Stream:   http://localhost:${PORT}/api/stream`);
  console.log(`======================================================\n`);
});
