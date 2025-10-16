require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const axios = require('axios');

class HyperliquidWhaleBot {
    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
        this.subscribers = new Set();
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.whaleThreshold = process.env.WHALE_THRESHOLD || 50000;
        this.activeAssets = ['BTC', 'ETH', 'SOL', 'ARB', 'AVAX'];
        
        this.setupBotCommands();
        this.connectWebSocket();
        this.startPriceUpdates();
    }

    setupBotCommands() {
        // Command untuk subscribe
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            this.subscribers.add(chatId);
            
            const welcomeMessage = `
🐋 **Hyperliquid Whale Tracker Bot**

Selamat datang! Bot ini akan mengirim notifikasi real-time tentang:
• Pergerakan whale dalam perpetual futures
• Long/Short posisi besar
• Likuidasi whale
• Volume trading tinggi

**Commands:**
/subscribe - Subscribe ke notifikasi
/unsubscribe - Unsubscribe dari notifikasi
/status - Status koneksi bot
/threshold [amount] - Set minimum whale threshold
/assets - Lihat aset yang dipantau

Bot sudah aktif! 🚀
            `;
            
            this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
        });

        // Subscribe command
        this.bot.onText(/\/subscribe/, (msg) => {
            const chatId = msg.chat.id;
            this.subscribers.add(chatId);
            this.bot.sendMessage(chatId, '✅ Berhasil subscribe ke notifikasi whale!');
        });

        // Unsubscribe command
        this.bot.onText(/\/unsubscribe/, (msg) => {
            const chatId = msg.chat.id;
            this.subscribers.delete(chatId);
            this.bot.sendMessage(chatId, '❌ Berhasil unsubscribe dari notifikasi whale.');
        });

        // Status command
        this.bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            const status = this.ws && this.ws.readyState === WebSocket.OPEN ? '🟢 Connected' : '🔴 Disconnected';
            const subscriberCount = this.subscribers.size;
            
            const statusMessage = `
**Bot Status:**
Connection: ${status}
Subscribers: ${subscriberCount}
Whale Threshold: $${this.whaleThreshold.toLocaleString()}
Monitored Assets: ${this.activeAssets.join(', ')}
            `;
            
            this.bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
        });

        // Set threshold command
        this.bot.onText(/\/threshold (\d+)/, (msg, match) => {
            const chatId = msg.chat.id;
            const newThreshold = parseInt(match[1]);
            
            if (newThreshold >= 1000) {
                this.whaleThreshold = newThreshold;
                this.bot.sendMessage(chatId, `✅ Whale threshold diubah ke $${newThreshold.toLocaleString()}`);
            } else {
                this.bot.sendMessage(chatId, '❌ Threshold minimum adalah \$1,000');
            }
        });

        // Assets command
        this.bot.onText(/\/assets/, (msg) => {
            const chatId = msg.chat.id;
            const assetList = this.activeAssets.map(asset => `• ${asset}-PERP`).join('
');
            
            this.bot.sendMessage(chatId, `**Aset yang dipantau:**
${assetList}`, { parse_mode: 'Markdown' });
        });
    }

    connectWebSocket() {
        try {
            this.ws = new WebSocket(process.env.HYPERLIQUID_WS_URL);
            
            this.ws.on('open', () => {
                console.log('✅ Connected to Hyperliquid WebSocket');
                this.reconnectAttempts = 0;
                
                // Subscribe to trades untuk semua aset
                this.activeAssets.forEach(asset => {
                    this.subscribeToTrades(asset);
                });
                
                // Subscribe to user events (untuk likuidasi)
                this.subscribeToAllMids();
            });

            this.ws.on('message', (data) => {
                this.handleWebSocketMessage(data);
            });

            this.ws.on('close', () => {
                console.log('❌ WebSocket connection closed');
                this.reconnectWebSocket();
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.reconnectWebSocket();
            });

        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.reconnectWebSocket();
        }
    }

    subscribeToTrades(coin) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const subscription = {
                method: 'subscribe',
                subscription: {
                    type: 'trades',
                    coin: coin
                }
            };
            this.ws.send(JSON.stringify(subscription));
        }
    }

    subscribeToAllMids() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const subscription = {
                method: 'subscribe',
                subscription: {
                    type: 'allMids'
                }
            };
            this.ws.send(JSON.stringify(subscription));
        }
    }

    handleWebSocketMessage(data) {
        try {
            const message = JSON.parse(data);
            
            if (message.channel === 'trades') {
                this.handleTradeMessage(message.data);
            } else if (message.channel === 'allMids') {
                this.handleAllMidsMessage(message.data);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    }

    handleTradeMessage(trades) {
        if (!Array.isArray(trades)) return;

        trades.forEach(trade => {
            const value = parseFloat(trade.px) * parseFloat(trade.sz);
            
            if (value >= this.whaleThreshold) {
                this.sendWhaleAlert(trade, value);
            }
        });
    }

    handleAllMidsMessage(midsData) {
        // Handle price updates untuk monitoring
        // Bisa digunakan untuk calculate PnL atau price alerts
    }

    async sendWhaleAlert(trade, value) {
        const side = trade.side === 'A' ? 'BUY 🟢' : 'SELL 🔴';
        const sideIcon = trade.side === 'A' ? '📈' : '📉';
        
        // Get additional market data
        const marketData = await this.getMarketData(trade.coin);
        
        const alertMessage = `
🐋 **WHALE ALERT** ${sideIcon}

**Asset:** ${trade.coin}-PERP
**Side:** ${side}
**Size:** ${parseFloat(trade.sz).toLocaleString()} ${trade.coin}
**Price:** $${parseFloat(trade.px).toLocaleString()}
**Value:** $${value.toLocaleString()}

**Market Info:**
${marketData ? `
• Mark Price: $${marketData.markPx}
• 24h Volume: $${marketData.volume24h}
• Open Interest: $${marketData.openInterest}
• Funding Rate: ${marketData.fundingRate}%
` : 'Loading market data...'}

**Time:** ${new Date(trade.time).toLocaleString()}
**Hash:** \`${trade.hash}\`

#Whale #${trade.coin} #Hyperliquid
        `;

        // Send ke semua subscribers
        this.subscribers.forEach(chatId => {
            this.bot.sendMessage(chatId, alertMessage, { 
                parse_mode: 'Markdown',
                disable_web_page_preview: true 
            });
        });
    }

    async getMarketData(coin) {
        try {
            const response = await axios.post(process.env.HYPERLIQUID_API_URL, {
                type: 'meta'
            });

            const meta = response.data;
            if (!meta || !meta.universe) return null;

            const assetInfo = meta.universe.find(u => u.name === coin);
            if (!assetInfo) return null;

            // Get mark price
            const allMidsResponse = await axios.post(process.env.HYPERLIQUID_API_URL, {
                type: 'allMids'
            });

            const markPx = allMidsResponse.data[coin] || 'N/A';

            // Get 24h stats
            const statsResponse = await axios.post(process.env.HYPERLIQUID_API_URL, {
                type: '24hrStats'
            });

            const stats = statsResponse.data?.[coin];

            return {
                markPx: markPx,
                volume24h: stats?.volume ? parseFloat(stats.volume).toLocaleString() : 'N/A',
                openInterest: stats?.openInterest ? parseFloat(stats.openInterest).toLocaleString() : 'N/A',
                fundingRate: stats?.fundingRate ? (parseFloat(stats.fundingRate) * 100).toFixed(4) : 'N/A'
            };

        } catch (error) {
            console.error('Error fetching market data:', error);
            return null;
        }
    }

    reconnectWebSocket() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connectWebSocket();
            }, 5000 * this.reconnectAttempts); // Exponential backoff
        } else {
            console.error('Max reconnection attempts reached');
            
            // Notify admin
            if (process.env.ADMIN_CHAT_ID) {
                this.bot.sendMessage(process.env.ADMIN_CHAT_ID, '🚨 Bot disconnected - manual restart required');
            }
        }
    }

    startPriceUpdates() {
        // Send daily summary
        setInterval(() => {
            this.sendDailySummary();
        }, 24 * 60 * 60 * 1000); // 24 hours

        // Heartbeat
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000); // 30 seconds
    }

    async sendDailySummary() {
        try {
            const summary = await this.getDailySummary();
            const summaryMessage = `
📊 **Daily Hyperliquid Summary**

**Top Volumes (24h):**
${summary.topVolumes.map(v => `• ${v.coin}: $${v.volume}`).join('
')}

**Largest Trades:**
${summary.largestTrades.map(t => `• ${t.coin}: $${t.value} (${t.side})`).join('
')}

**Market Stats:**
• Total Volume: $${summary.totalVolume}
• Active Whales: ${summary.activeWhales}
• Liquidations: $${summary.totalLiquidations}

#DailySummary #Hyperliquid
            `;

            this.subscribers.forEach(chatId => {
                this.bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
            });

        } catch (error) {
            console.error('Error sending daily summary:', error);
        }
    }

    async getDailySummary() {
        // Implement daily summary logic
        return {
            topVolumes: [
                { coin: 'BTC', volume: '125.5M' },
                { coin: 'ETH', volume: '89.2M' },
                { coin: 'SOL', volume: '45.1M' }
            ],
            largestTrades: [
                { coin: 'BTC', value: '2.5M', side: 'BUY' },
                { coin: 'ETH', value: '1.8M', side: 'SELL' }
            ],
            totalVolume: '1.2B',
            activeWhales: 47,
            totalLiquidations: '15.3M'
        };
    }
}

// Start the bot
console.log('🚀 Starting Hyperliquid Whale Tracker Bot...');
const bot = new HyperliquidWhaleBot();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    if (bot.ws) {
        bot.ws.close();
    }
    process.exit(0);
});
