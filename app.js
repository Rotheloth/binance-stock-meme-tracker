// State Store
let state = {
  tokens: [],
  events: [],
  stats: {},
  filter: 'ALL',        // 'ALL', 'ADDED', 'REMOVED'
  chainFilter: 'ALL',   // 'ALL', 'BSC', 'ROBINHOOD'
  searchQuery: '',
  sortBy: 'launchTime_desc',
  soundEnabled: true
};

// Web Audio API Acoustic Piano Synthesizer
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Unmute AudioContext on user interaction
function unlockAudio() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}
['click', 'touchstart', 'keydown', 'pointerdown'].forEach(evtType => {
  document.addEventListener(evtType, unlockAudio, { once: false });
});

function playPianoNote(frequency, startTime, duration = 1.2, gainValue = 0.2) {
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  } catch (e) {
    console.warn('Piano synth note error:', e);
  }
}

function playAlertSound(type) {
  if (!state.soundEnabled) return;
  try {
    unlockAudio();
    const now = audioCtx.currentTime;

    if (type === 'ADDED') {
      // Gentle C-Major Piano Arpeggio (C5 -> E5 -> G5)
      playPianoNote(523.25, now + 0.00, 1.4, 0.22);
      playPianoNote(659.25, now + 0.08, 1.4, 0.20);
      playPianoNote(783.99, now + 0.16, 1.6, 0.25);
    } else if (type === 'RE_ADDED') {
      // D-Major chord for re-add (D5 -> F#5 -> A5) — slightly different tone
      playPianoNote(587.33, now + 0.00, 1.3, 0.20);
      playPianoNote(739.99, now + 0.10, 1.3, 0.18);
      playPianoNote(880.00, now + 0.20, 1.5, 0.22);
    } else if (type === 'REMOVED') {
      // Gentle A-Minor Soft Piano Interval (E5 -> C5 -> A4)
      playPianoNote(659.25, now + 0.00, 1.2, 0.18);
      playPianoNote(523.25, now + 0.08, 1.2, 0.18);
      playPianoNote(440.00, now + 0.16, 1.5, 0.20);
    }
  } catch (e) {
    console.warn('Piano alert error:', e);
  }
}

// Utility Formatters
function formatCurrency(val) {
  if (val === null || val === undefined || isNaN(val) || val === 0) return '$0.00';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(2)}K`;
  if (val < 0.0001) return `$${val.toFixed(6)}`;
  return `$${val.toFixed(4)}`;
}

function formatPercent(val) {
  if (val === null || val === undefined || isNaN(val)) return '0.00%';
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(2)}%`;
}

function shortenAddress(addr) {
  if (!addr) return '';
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
}

function timeAgo(timestamp) {
  if (!timestamp) return 'Bilinmiyor';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'Az önce';
  if (seconds < 60) return `${seconds}s önce`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h önce`;
  const days = Math.floor(hours / 24);
  return `${days}d önce`;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btn.innerText;
    btn.innerText = 'Kopyalandı ✓';
    btn.style.background = '#00F090';
    btn.style.color = '#000';
    setTimeout(() => {
      btn.innerText = originalText;
      btn.style.background = '';
      btn.style.color = '';
    }, 1500);
  });
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

function renderSocialLinks(item) {
  let html = '';
  if (item.website) {
    html += `<a href="${item.website}" target="_blank" class="social-icon-link" title="Website"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg></a>`;
  }
  if (item.twitter) {
    html += `<a href="${item.twitter}" target="_blank" class="social-icon-link" title="X (Twitter)"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>`;
  }
  if (item.telegram) {
    html += `<a href="${item.telegram}" target="_blank" class="social-icon-link" title="Telegram"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.67-.52.36-1 .54-1.42.53-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.36-.49.99-.75 3.87-1.68 6.46-2.79 7.76-3.33 3.69-1.54 4.46-1.81 4.96-1.82.11 0 .35.03.5.14.13.1.17.24.19.34.02.13.02.26-.01.39z"/></svg></a>`;
  }
  return html;
}

function renderAvatar(symbol, iconUrl) {
  const initial = (symbol || 'M').charAt(0).toUpperCase();
  let fullUrl = iconUrl;
  if (fullUrl && fullUrl.startsWith('/')) {
    fullUrl = `https://bin.bnbstatic.com${fullUrl}`;
  }

  if (fullUrl && fullUrl !== 'null' && fullUrl !== 'undefined') {
    return `<div class="token-avatar"><img src="${fullUrl}" onerror="this.style.display='none'; this.parentNode.innerText='${initial}';" alt="${symbol}"></div>`;
  }
  return `<div class="token-avatar">${initial}</div>`;
}

// Chain-aware GMGN & BasedBot URL Generators
function getGmgnUrl(token) {
  const ca = (token.contractAddress || '').toLowerCase();
  const chainId = token.chainId || '56';

  if (chainId === '4663' || (token.chainName && token.chainName.toLowerCase().includes('robinhood'))) {
    return `https://web3.binance.com/en/markets/stock-meme-coins?chain=robinhood`;
  }
  return `https://gmgn.ai/bsc/token/${ca}`;
}

function getBasedBotUrl(token) {
  const ca = (token.contractAddress || '').toLowerCase();
  return `https://t.me/based_eth_bot?start=${ca}`;
}

// Toast Notifications
function showToast(title, message, type) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const cssClass = type === 'RE_ADDED' ? 'ADDED' : type;
  toast.className = `toast-item ${cssClass}`;
  const icon = type === 'ADDED' ? '🟢' : type === 'RE_ADDED' ? '🔄' : '🔴';
  toast.innerHTML = `
    <div style="font-size: 1.2rem;">${icon}</div>
    <div>
      <strong style="display: block; font-weight: 700;">${title}</strong>
      <span style="font-size: 0.78rem; color: #929AA5;">${message}</span>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// UI Render Functions
function renderStats() {
  const bscCount = state.stats.bscCount || state.tokens.filter(t => t.chainId === '56').length || 0;
  const robinhoodCount = state.stats.robinhoodCount || state.tokens.filter(t => t.chainId === '4663').length || 0;

  document.getElementById('totalActiveCount').innerText = state.stats.totalActive || state.tokens.length || 0;
  document.getElementById('bscCountTag').innerText = `BSC: ${bscCount}`;
  document.getElementById('robinhoodCountTag').innerText = `Robinhood: ${robinhoodCount}`;

  if (state.stats.lastPollTime) {
    document.getElementById('lastUpdatedTime').innerText = timeAgo(state.stats.lastPollTime);
  }
}

function renderEventsFeed() {
  const feedList = document.getElementById('eventFeedList');
  let events = state.events;

  if (state.filter !== 'ALL') {
    if (state.filter === 'ADDED') {
      events = events.filter(e => e.type === 'ADDED' || e.type === 'RE_ADDED');
    } else {
      events = events.filter(e => e.type === state.filter);
    }
  }

  if (state.chainFilter !== 'ALL') {
    const targetChainId = state.chainFilter === 'BSC' ? '56' : '4663';
    events = events.filter(e => e.chainId === targetChainId);
  }

  document.getElementById('eventCountBadge').innerText = `${events.length} Olay`;

  if (events.length === 0) {
    feedList.innerHTML = `
      <div class="feed-empty">
        <p>Henüz bu filtreye uygun değişim olayı kaydedilmedi.</p>
      </div>
    `;
    return;
  }

  feedList.innerHTML = events.map(evt => {
    const isAdd = (evt.type === 'ADDED');
    const isReAdd = (evt.type === 'RE_ADDED');
    const isRemove = (evt.type === 'REMOVED');

    let badgeText;
    if (isAdd) {
      badgeText = '🟢 YENİ EKLENDİ';
    } else if (isReAdd) {
      badgeText = '🔄 TEKRAR EKLENDİ';
    } else {
      badgeText = '🔴 ÇIKARILDI';
    }

    const avatarHtml = renderAvatar(evt.symbol, evt.icon);
    const chainName = evt.chainName || (evt.chainId === '4663' ? 'Robinhood' : 'BSC');
    const chainClass = evt.chainId === '4663' ? 'robinhood' : 'bsc';
    const gmgnUrl = getGmgnUrl(evt);
    const basedBotUrl = getBasedBotUrl(evt);
    const tokenAge = formatTokenAge(evt.launchTime);
    const socialsHtml = renderSocialLinks(evt);

    const mcFormatted = evt.marketCap ? formatCurrency(evt.marketCap) : '-';
    const liqFormatted = evt.liquidity ? formatCurrency(evt.liquidity) : '-';
    const holdersFormatted = evt.holders ? evt.holders.toLocaleString() : '-';

    // Extra info line for RE_ADDED events
    let reAddInfoHtml = '';
    if (isReAdd) {
      const timeText = formatTime(evt.timestamp);
      const lastRemovedText = evt.lastRemovedTime ? timeAgo(evt.lastRemovedTime) : '';
      reAddInfoHtml = `
        <div class="re-add-info">
          <span>⏰ ${timeText}</span>
          ${lastRemovedText ? `<span>🕐 Çıkarılma: ${lastRemovedText}</span>` : ''}
        </div>
      `;
    }

    const typePillClass = isReAdd ? 'RE_ADDED' : (isAdd ? 'ADDED' : 'REMOVED');
    const feedCardClass = isReAdd ? 'ADDED' : (isAdd ? 'ADDED' : 'REMOVED');

    return `
      <div class="feed-card ${feedCardClass}">
        <div class="feed-top-bar">
          <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
            <span class="type-pill ${typePillClass}">${badgeText}</span>
            <span class="chain-badge ${chainClass}">${chainName}</span>
          </div>
          <span class="feed-time">${timeAgo(evt.timestamp)}</span>
        </div>

        <a href="${gmgnUrl}" target="_blank" class="feed-token-main">
          ${avatarHtml}
          <div class="feed-token-info">
            <h4>${evt.symbol}</h4>
            <p>${evt.name}</p>
          </div>
        </a>

        ${reAddInfoHtml}

        <div class="ca-strip">
          <span class="token-age-tag">${tokenAge}</span>
          <span class="ca-divider">|</span>
          <span class="ca-address">${shortenAddress(evt.contractAddress)}</span>
          <button class="copy-icon-btn" onclick="copyToClipboard('${evt.contractAddress}', this)">Kopyala</button>
          <div class="social-links-inline">
            ${socialsHtml}
          </div>
        </div>

        <div class="card-stats-grid">
          <div class="stat-box">
            <span class="stat-label">Market Cap</span>
            <span class="stat-val mc-highlight">${mcFormatted}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Liquidity</span>
            <span class="stat-val">${liqFormatted}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Holders</span>
            <span class="stat-val">${holdersFormatted}</span>
          </div>
        </div>

        <div class="feed-bottom-action">
          <a href="${basedBotUrl}" target="_blank" class="btn-action-pill btn-basedbot">
            <span class="btn-icon">🤖</span>
            <span class="btn-text">Basedbot</span>
            <span class="btn-arrow">↗</span>
          </a>
          <a href="${gmgnUrl}" target="_blank" class="btn-action-pill btn-gmgn">
            <span class="btn-icon">🦖</span>
            <span class="btn-text">GMGN</span>
            <span class="btn-arrow">↗</span>
          </a>
        </div>
      </div>
    `;
  }).join('');
}

function renderActiveTokensTable() {
  const tbody = document.getElementById('tokensTableBody');
  let tokens = [...state.tokens];

  if (state.chainFilter !== 'ALL') {
    const targetChainId = state.chainFilter === 'BSC' ? '56' : '4663';
    tokens = tokens.filter(t => t.chainId === targetChainId);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    tokens = tokens.filter(t => 
      (t.symbol && t.symbol.toLowerCase().includes(q)) ||
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.contractAddress && t.contractAddress.toLowerCase().includes(q))
    );
  }

  tokens.sort((a, b) => {
    switch (state.sortBy) {
      case 'launchTime_desc':
        return (b.launchTime || 0) - (a.launchTime || 0);
      case 'change24h_desc':
        return b.percentChange24h - a.percentChange24h;
      case 'volume24h_desc':
        return b.volume24h - a.volume24h;
      case 'marketCap_desc':
        return b.marketCap - a.marketCap;
      case 'liquidity_desc':
        return b.liquidity - a.liquidity;
      default:
        return 0;
    }
  });

  document.getElementById('activeTokensBadge').innerText = `${tokens.length} Coin`;

  if (tokens.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="feed-empty">
          Aranan kriterlere uygun aktif stock meme coin bulunamadı.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = tokens.map(t => {
    const avatarHtml = renderAvatar(t.symbol, t.icon);
    
    const chainName = t.chainName || (t.chainId === '4663' ? 'Robinhood' : 'BSC');
    const chainClass = t.chainId === '4663' ? 'robinhood' : 'bsc';
    const gmgnUrl = getGmgnUrl(t);
    const basedBotUrl = getBasedBotUrl(t);
    const tokenAge = formatTokenAge(t.launchTime);
    const socialsHtml = renderSocialLinks(t);

    const tagList = [];
    if (t.tags) {
      Object.values(t.tags).flat().forEach(tg => {
        if (tg && tg.tagName && !tagList.includes(tg.tagName)) {
          tagList.push(tg.tagName);
        }
      });
    }
    const visibleTags = tagList.slice(0, 3);
    const tagsHtml = visibleTags.map(tg => `<span class="tbl-tag">${tg}</span>`).join('');

    return `
      <tr>
        <td>
          <a href="${gmgnUrl}" target="_blank" class="tbl-token-cell">
            ${avatarHtml}
            <div class="tbl-token-meta">
              <h5>${t.symbol}</h5>
              <span>${t.name}</span>
            </div>
          </a>
        </td>
        <td>
          <span class="chain-badge ${chainClass}">${chainName}</span>
        </td>
        <td>
          <div class="tbl-ca-cell">
            <span class="token-age-tag">${tokenAge}</span>
            <span class="ca-divider">|</span>
            <span>${shortenAddress(t.contractAddress)}</span>
            <button class="copy-icon-btn" onclick="copyToClipboard('${t.contractAddress}', this)">Kopyala</button>
            <div class="social-links-inline">
              ${socialsHtml}
            </div>
          </div>
        </td>
        <td>
          <span class="price-val">${formatCurrency(t.price)}</span>
        </td>
        <td>
          <div class="change-pill-group">
            <span class="chg-pill ${t.percentChange5m >= 0 ? 'up' : 'down'}">5m ${formatPercent(t.percentChange5m)}</span>
            <span class="chg-pill ${t.percentChange1h >= 0 ? 'up' : 'down'}">1h ${formatPercent(t.percentChange1h)}</span>
            <span class="chg-pill ${t.percentChange24h >= 0 ? 'up' : 'down'}">24h ${formatPercent(t.percentChange24h)}</span>
          </div>
        </td>
        <td><span style="font-family: var(--font-mono); font-weight: 700; color: #00E5FF;">${formatCurrency(t.marketCap)}</span></td>
        <td><span style="font-family: var(--font-mono);">${formatCurrency(t.liquidity)}</span></td>
        <td><span style="font-family: var(--font-mono); font-weight: 600;">${t.holders ? t.holders.toLocaleString() : '-'}</span></td>
        <td>
          <div class="tbl-actions">
            <a href="${basedBotUrl}" target="_blank" class="btn-action-pill btn-basedbot-sm">🤖 Basedbot ↗</a>
            <a href="${gmgnUrl}" target="_blank" class="btn-action-pill btn-gmgn-sm">🦖 GMGN ↗</a>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updateUI() {
  renderStats();
  renderEventsFeed();
  renderActiveTokensTable();
}

function setupListeners() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.filter = e.target.getAttribute('data-filter');
      renderEventsFeed();
    });
  });

  document.querySelectorAll('.chain-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.chain-tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.chainFilter = e.target.getAttribute('data-chain');
      renderActiveTokensTable();
      renderEventsFeed();
    });
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    renderActiveTokensTable();
  });

  document.getElementById('sortSelect').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderActiveTokensTable();
  });

  const soundBtn = document.getElementById('soundToggleBtn');
  soundBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    document.getElementById('soundIcon').innerText = state.soundEnabled ? '🎹' : '🔕';
    document.getElementById('soundText').innerText = state.soundEnabled ? 'Piyano Sesi: Açık' : 'Piyano Sesi: Kapalı';
  });
}

function initSSE() {
  const statusEl = document.getElementById('connectionStatus');
  const statusText = document.getElementById('statusText');

  const evtSource = new EventSource('/api/stream');

  evtSource.onopen = () => {
    statusEl.style.borderColor = 'var(--green-border)';
    statusEl.style.background = 'var(--green-glow)';
    statusEl.style.color = 'var(--neon-green)';
    statusText.innerText = 'CANLI BAĞLI (SSE)';
  };

  evtSource.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);

      if (payload.event === 'INITIAL_STATE') {
        state.tokens = payload.data.tokens || [];
        state.events = payload.data.events || [];
        state.stats = payload.data.stats || {};
        updateUI();
      }

      if (payload.event === 'NEW_EVENTS') {
        const newEvts = payload.data || [];
        newEvts.forEach(evt => {
          state.events.unshift(evt);
          playAlertSound(evt.type);

          const chainLabel = evt.chainName || (evt.chainId === '4663' ? 'Robinhood' : 'BSC');
          let title, toastType;
          if (evt.type === 'ADDED') {
            title = `🟢 YENİ EKLENDİ [${chainLabel}]: ${evt.symbol}`;
            toastType = 'ADDED';
          } else if (evt.type === 'RE_ADDED') {
            const mcText = evt.marketCap ? formatCurrency(evt.marketCap) : '';
            title = `🔄 TEKRAR EKLENDİ [${chainLabel}]: ${evt.symbol}${mcText ? ' | MC: ' + mcText : ''}`;
            toastType = 'RE_ADDED';
          } else {
            title = `🔴 ÇIKARILDI [${chainLabel}]: ${evt.symbol}`;
            toastType = 'REMOVED';
          }
          const msg = `${evt.name} (${shortenAddress(evt.contractAddress)})`;
          showToast(title, msg, toastType);
        });

        fetchActiveTokens();
      }

      if (payload.event === 'STATUS') {
        state.stats = payload.data || {};
        renderStats();
      }
    } catch (err) {
      console.error('[SSE ERROR]', err);
    }
  };

  evtSource.onerror = () => {
    statusEl.style.borderColor = 'var(--red-border)';
    statusEl.style.background = 'var(--red-glow)';
    statusEl.style.color = 'var(--neon-red)';
    statusText.innerText = 'Bağlantı Kesildi (Yeniden Bağlanılıyor)';
  };
}

async function fetchActiveTokens() {
  try {
    const res = await fetch('/api/tokens');
    const data = await res.json();
    if (data.success) {
      state.tokens = data.data;
      renderActiveTokensTable();
    }
  } catch (e) {
    console.error('Error fetching tokens:', e);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupListeners();
  initSSE();

  setInterval(() => {
    renderStats();
    renderEventsFeed();
  }, 10000);
});
