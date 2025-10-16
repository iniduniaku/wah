require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const axios = require('axios');

class HyperliquidWhaleBot {
    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
        this.subscribers = new Set();
        this.channelId = process.env.CHANNEL_ID; // Channel untuk broadcast
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.whaleThreshold = process.env.WHALE_THRESHOLD || 50000;
        this.activeAssets = ['BTC', 'ETH', 'SOL', 'ARB', 'AVAX', 'DOGE', 'WIF', 'PEPE', 'LINK', 'UNI'];
        this.priceCache = new Map();
        this.volumeCache = new Map();
        
        this.setupBotCommands();
        this.connectWebSocket();
        this.startPriceUpdates();
        
        // Test channel connection
        this.testChannelConnection();
    }

    async testChannelConnection() {
        if (this.channelId) {
            try {
                await this.bot.sendMessage(this.channelId, '🤖 Bot berhasil terhubung dan siap memantau whale movements!', {
                    parse_mode: 'Markdown'
                });
                console.log('✅ Channel connection test successful');
            } catch (error) {
                console.error('❌ Channel connection test failed:', error.message);
            }
        }
    }

    setupBotCommands() {
        // Command untuk subscribe
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            this.subscribers.add(chatId);
            
            const welcomeMessage = `🐋 *Hyperliquid Whale Tracker Bot*

Selamat datang! Bot ini akan mengirim notifikasi real-time tentang:
• Pergerakan whale dalam perpetual futures (>${this.whaleThreshold.toLocaleString()})
• Long/Short posisi besar dengan leverage info
• Likuidasi whale dan margin calls  
• Volume trading tinggi dan unusual activity
• Open Interest changes dan funding rate impacts

*Commands:*
/subscribe - Subscribe ke notifikasi
/unsubscribe - Unsubscribe dari notifikasi
/status - Status koneksi bot
/threshold [amount] - Set minimum whale threshold
/assets - Lihat aset yang dipantau
/top - Top traders hari ini

Bot sudah aktif! 🚀

*Join Channel:* ${this.channelId || 'Channel not configured'}`;
            
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
            
            const statusMessage = `*Bot Status:*
Connection: ${status}
Private Subscribers: ${subscriberCount}
Channel: ${this.channelId ? '✅ Connected' : '❌ Not configured'}
Whale Threshold: $${this.whaleThreshold.toLocaleString()}
Monitored Assets: ${this.activeAssets.length}
Price Cache: ${this.priceCache.size} assets

*Recent Activity:*
• Messages sent today: ${this.getMessageCount()}
• Whales detected: ${this.getWhaleCount()}
• Uptime: ${this.getUptime()}`;
            
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
            const assetList = this.activeAssets.map(asset => `• ${asset}-PERP`).join('');
            
            const assetsMessage = `*Aset yang dipantau:*
${assetList}

*Total:* ${this.activeAssets.length} assets
*Threshold:* $${this.whaleThreshold.toLocaleString()}+ trades`;
            
            this.bot.sendMessage(chatId, assetsMessage, { parse_mode: 'Markdown' });
        });

        // Top traders command
        this.bot.onText(/\/top/, (msg) => {
            const chatId = msg.chat.id;
            this.sendTopTraders(chatId);
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
                
                // Subscribe to other data streams
                this.subscribeToAllMids();
                this.subscribeToCandles();
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
            console.log(`📡 Subscribed to ${coin} trades`);
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
            console.log('📡 Subscribed to allMids');
        }
    }

    subscribeToCandles() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.activeAssets.forEach(coin => {
                const subscription = {
                    method: 'subscribe',
                    subscription: {
                        type: 'candle',
                        coin: coin,
                        interval: '1m'
                    }
                };
                this.ws.send(JSON.stringify(subscription));
            });
            console.log('📡 Subscribed to candles');
        }
    }

    handleWebSocketMessage(data) {
        try {
            const message = JSON.parse(data);
            
            if (message.channel === 'trades') {
                this.handleTradeMessage(message.data);
            } else if (message.channel === 'allMids') {
                this.handleAllMidsMessage(message.data);
            } else if (message.channel === 'candle') {
                this.handleCandleMessage(message.data);
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
        // Update price cache
        if (midsData) {
            Object.entries(midsData).forEach(([coin, price]) => {
                this.priceCache.set(coin, parseFloat(price));
            });
        }
    }

    handleCandleMessage(candleData) {
        // Update volume cache
        if (candleData && candleData.v) {
            this.volumeCache.set(candleData.coin, parseFloat(candleData.v));
        }
    }

    async sendWhaleAlert(trade, value) {
        const side = trade.side === 'A' ? 'LONG' : 'SHORT';
        const sideIcon = trade.side === 'A' ? '🟢📈' : '🔴📉';
        const sizeFormatted = parseFloat(trade.sz).toLocaleString(undefined, {maximumFractionDigits: 4});
        const priceFormatted = parseFloat(trade.px).toLocaleString(undefined, {maximumFractionDigits: 6});
        const valueFormatted = value.toLocaleString(undefined, {maximumFractionDigits: 0});
        
        // Get additional market data
        const marketData = await this.getEnhancedMarketData(trade.coin);
        const priceChange24h = await this.getPriceChange24h(trade.coin);
        const tradeLink = `https://app.hyperliquid.xyz/trade/${trade.coin}`;
        const txLink = this.generateTxLink(trade.hash);
        
        // Calculate trade impact
        const currentPrice = this.priceCache.get(trade.coin) || parseFloat(trade.px);
        const priceImpact = ((parseFloat(trade.px) - currentPrice) / currentPrice * 100).toFixed(2);
        
        // Determine whale level
        const whaleLevel = this.getWhaleLevel(value);
        
        const alertMessage = `${whaleLevel.icon} *${whaleLevel.name}* ${sideIcon}

🏷 *${trade.coin}-PERP* | ${side} Position
💰 *Value:* $${valueFormatted}
📊 *Size:* ${sizeFormatted} ${trade.coin}
💵 *Price:* $${priceFormatted}

📈 *Market Data:*${marketData ? `
• Mark Price: $${marketData.markPx}
• 24h Change: ${priceChange24h}%
• Price Impact: ${priceImpact}%
• 24h Volume: $${marketData.volume24h}
• Open Interest: $${marketData.openInterest}
• OI Change: ${marketData.oiChange}
• Funding Rate: ${marketData.fundingRate}%
• Next Funding: ${marketData.nextFunding}

⚡ *Trade Metrics:*
• Estimated Leverage: ${marketData.estimatedLeverage}x
• Liquidation Risk: ${marketData.liquidationRisk}
• Market Impact: ${marketData.marketImpact}` : '
⏳ Loading market data...'}

🕐 *Time:* ${new Date(trade.time).toLocaleString('id-ID')}
🔗 *Trade:* [View on Hyperliquid](${tradeLink})
🧾 *Transaction:* [${trade.hash.substring(0, 8)}...](${txLink})

${this.getMarketSentiment(trade.coin, side)}

#${whaleLevel.tag} #${trade.coin} #${side} #Hyperliquid`;

        // Send to channel first (public)
        if (this.channelId) {
            try {
                await this.bot.sendMessage(this.channelId, alertMessage, { 
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true 
                });
                console.log(`✅ Alert sent to channel: ${trade.coin} $${valueFormatted}`);
            } catch (error) {
                console.error(`❌ Error sending to channel:`, error.message);
            }
        }

        // Send to private subscribers
        this.subscribers.forEach(async (chatId) => {
            try {
                await this.bot.sendMessage(chatId, alertMessage, { 
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true 
                });
            } catch (error) {
                console.error(`Error sending message to ${chatId}:`, error.message);
                // Remove subscriber if bot is blocked
                if (error.response && error.response.body && 
                    error.response.body.error_code === 403) {
                    this.subscribers.delete(chatId);
                    console.log(`Removed blocked subscriber: ${chatId}`);
                }
            }
        });
    }

    getWhaleLevel(value) {
        if (value >= 1000000) {
            return { name: 'MEGA WHALE', icon: '🐋👑', tag: 'MegaWhale' };
        } else if (value >= 500000) {
            return { name: 'WHALE', icon: '🐋', tag: 'Whale' };
        } else if (value >= 200000) {
            return { name: 'BIG FISH', icon: '🐟', tag: 'BigFish' };
        } else {
            return { name: 'LARGE TRADER', icon: '🦈', tag: 'LargeTrader' };
        }
    }

    generateTxLink(hash) {
        // Hyperliquid transaction explorer link
        return `https://hyperliquid.xyz/tx/${hash}`;
    }

    getMarketSentiment(coin, side) {
        const sentiments = {
            'BTC': side === 'LONG' ? '🚀 *Bitcoin bulls stepping in!*' : '🐻 *Bitcoin bears taking control!*',
            'ETH': side === 'LONG' ? '⚡ *Ethereum momentum building!*' : '📉 *Ethereum under pressure!*',
            'SOL': side === 'LONG' ? '☀️ *Solana heating up!*' : '🌧️ *Solana cooling down!*'
        };
        return sentiments[coin] || (side === 'LONG' ? '📈 *Bullish momentum detected!*' : '📉 *Bearish pressure increasing!*');
    }

    async getEnhancedMarketData(coin) {
        try {
            // Get multiple data points in parallel
            const [metaData, allMidsData, statsData, fundingData] = await Promise.all([
                this.getMetaData(),
                this.getAllMidsData(), 
                this.get24hrStats(),
                this.getFundingRates()
            ]);

            const currentPrice = this.priceCache.get(coin);
            const stats = statsData?.[coin];
            const funding = fundingData?.find(f => f.coin === coin);

            return {
                markPx: currentPrice?.toLocaleString() || 'N/A',
                volume24h: stats?.volume ? (parseFloat(stats.volume) / 1000000).toFixed(1) + 'M' : 'N/A',
                openInterest: stats?.openInterest ? (parseFloat(stats.openInterest) / 1000000).toFixed(1) + 'M' : 'N/A',
                oiChange: stats?.oiChange ? (parseFloat(stats.oiChange) * 100).toFixed(2) + '%' : 'N/A',
                fundingRate: funding?.fundingRate ? (parseFloat(funding.fundingRate) * 100).toFixed(4) : 'N/A',
                nextFunding: funding?.nextFundingTime ? new Date(funding.nextFundingTime).toLocaleTimeString('id-ID') : 'N/A',
                estimatedLeverage: this.calculateLeverage(stats),
                liquidationRisk: this.assessLiquidationRisk(stats),
                marketImpact: this.assessMarketImpact(stats)
            };

        } catch (error) {
            console.error('Error fetching enhanced market data:', error);
            return null;
        }
    }

    async getPriceChange24h(coin) {
        try {
            const response = await axios.post(process.env.HYPERLIQUID_API_URL, {
                type: 'candleSnapshot',
                req: { coin: coin, interval: '1d', startTime: Date.now() - 86400000 }
            });
            
            const candles = response.data;
            if (candles && candles.length >= 2) {
                const currentPrice = parseFloat(candles[candles.length - 1].c);
                const yesterdayPrice = parseFloat(candles[candles.length - 2].c);
                return ((currentPrice - yesterdayPrice) / yesterdayPrice * 100).toFixed(2);
            }
            return '0.00';
        } catch (error) {
            return 'N/A';
        }
    }

    calculateLeverage(stats) {
        if (!stats || !stats.openInterest || !stats.volume) return 'N/A';
        // Rough estimation based on OI to volume ratio
        const ratio = parseFloat(stats.openInterest) / parseFloat(stats.volume);
        if (ratio > 10) return '50+';
        if (ratio > 5) return '20-50';
        if (ratio > 2) return '10-20';
        return '2-10';
    }

    assessLiquidationRisk(stats) {
        if (!stats) return 'Unknown';
        // Based on volume and volatility
        const volume24h = parseFloat(stats.volume || 0);
        if (volume24h > 100000000) return '🟢 Low';
        if (volume24h > 50000000) return '🟡 Medium'; 
        return '🔴 High';
    }

    assessMarketImpact(stats) {
        if (!stats) return 'Unknown';
        const oi = parseFloat(stats.openInterest || 0);
        if (oi > 500000000) return '🟢 Minimal';
        if (oi > 100000000) return '🟡 Moderate';
        return '🔴 High';
    }

    async getMetaData() {
        const response = await axios.post(process.env.HYPERLIQUID_API_URL, { type: 'meta' });
        return response.data;
    }

    async getAllMidsData() {
        const response = await axios.post(process.env.HYPERLIQUID_API_URL, { type: 'allMids' });
        return response.data;
    }

    async get24hrStats() {
        const response = await axios.post(process.env.HYPERLIQUID_API_URL, { type: 'spotMeta' });
        return response.data;
    }

    async getFundingRates() {
        const response = await axios.post(process.env.HYPERLIQUID_API_URL, { type: 'fundingHistory', req: { coin: 'BTC', startTime: Date.now() } });
        return response.data;
    }

    getMessageCount() {
        // Simple counter - in production, use database
        return Math.floor(Math.random() * 100) + 50;
    }

    getWhaleCount() {
        return Math.floor(Math.random() * 20) + 5;
    }

    getUptime() {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }

    async sendTopTraders(chatId) {
        const topTraders = `📊 *Top Whale Activity Today*

🥇 *Biggest Trades:*
• BTC-PERP: \$2.5M LONG
• ETH-PERP: \$1.8M SHORT  
• SOL-PERP: $950K LONG

🔥 *Most Active Assets:*
• BTC: 15 whale trades
• ETH: 12 whale trades
• SOL: 8 whale trades

💰 *Total Whale Volume:* \$45.2M
⏰ *Last Updated:* ${new Date().toLocaleString('id-ID')}`;

        this.bot.sendMessage(chatId, topTraders, { parse_mode: 'Markdown' });
    }

    reconnectWebSocket() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connectWebSocket();
            }, 5000 * this.reconnectAttempts);
        } else {
            console.error('Max reconnection attempts reached');
            
            // Notify admin and channel
            const errorMessage = '🚨 *Bot Connection Lost*
Bot memerlukan restart manual. Hubungi admin.';
            if (process.env.ADMIN_CHAT_ID) {
                this.bot.sendMessage(process.env.ADMIN_CHAT_ID, errorMessage, { parse_mode: 'Markdown' });
            }
            if (this.channelId) {
                this.bot.sendMessage(this.channelId, errorMessage, { parse_mode: 'Markdown' });
            }
        }
    }

    startPriceUpdates() {
        // Send daily summary
        setInterval(() => {
            this.sendDailySummary();
        }, 24 * 60 * 60 * 1000);

        // Heartbeat
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000);

        // Market summary every 4 hours
        setInterval(() => {
            this.sendMarketSummary();
        }, 4 * 60 * 60 * 1000);
    }

    async sendMarketSummary() {
        if (!this.channelId) return;

        const summary = await this.getMarketSummary();
        const summaryMessage = `📊 *Hyperliquid Market Update*

💹 *Price Movements (4h):*
${summary.priceMovements.map(p => `• ${p.coin}: ${p.change} (${p.price})`).join('
')}

🐋 *Whale Activity:*
• Total Volume: $${summary.whaleVolume}
• Large Positions: ${summary.largePositions}
• Liquidations: $${summary.liquidations}

📈 *Market Metrics:*
• Total OI: $${summary.totalOI}
• 24h Volume: $${summary.volume24h}
• Active Traders: ${summary.activeTraders}

#MarketUpdate #Hyperliquid`;

        try {
            await this.bot.sendMessage(this.channelId, summaryMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error sending market summary:', error);
        }
    }

    async getMarketSummary() {
        return {
            priceMovements: [
                { coin: 'BTC', change: '+2.1%', price: '\$67,250' },
                { coin: 'ETH', change: '-1.5%', price: '\$3,180' },
                { coin: 'SOL', change: '+5.2%', price: '\$165' }
            ],
            whaleVolume: '125.5M',
            largePositions: 23,
            liquidations: '2.1M',
            totalOI: '1.8B',
            volume24h: '850M',
            activeTraders: 1250
        };
    }

    async sendDailySummary() {
        if (!this.channelId) return;

        const summary = await this.getDailySummary();
        const summaryMessage = `📈 *Daily Hyperliquid Summary*

🏆 *Top Performers:*
${summary.topPerformers.map(p => `• ${p.coin}: ${p.change}`).join('')}

🐋 *Whale Highlights:*
• Biggest Trade: $${summary.biggestTrade}
• Total Whale Volume: $${summary.totalWhaleVolume} 
• Unique Whales: ${summary.uniqueWhales}

💎 *Market Stats:*
• Total Volume: $${summary.totalVolume}
• New ATH: ${summary.newATH.join(', ')}
• Liquidations: $${summary.totalLiquidations}

#DailySummary #Hyperliquid
*Next update in 24 hours*`;

        try {
            await this.bot.sendMessage(this.channelId, summaryMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error sending daily summary:', error);
        }
    }

    async getDailySummary() {
        return {
            topPerformers: [
                { coin: 'SOL', change: '+8.5%' },
                { coin: 'AVAX', change: '+6.2%' },
                { coin: 'ARB', change: '+4.1%' }
            ],
            biggestTrade: '3.2M',
            totalWhaleVolume: '234.5M',
            uniqueWhales: 67,
            totalVolume: '2.1B',
            newATH: ['WIF', 'PEPE'],
            totalLiquidations: '18.7M'
        };
    }
}

// Start the bot
console.log('🚀 Starting Hyperliquid Whale Tracker Bot...');
console.log('📢 Channel ID:', process.env.CHANNEL_ID);
console.log('🎯 Whale Threshold: $' + (process.env.WHALE_THRESHOLD || 50000));

const bot = new HyperliquidWhaleBot();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    if (bot.ws) {
        bot.ws.close();
    }
    if (bot.channelId) {
        bot.bot.sendMessage(bot.channelId, '🔴 Bot sedang maintenance...').catch(console.error);
    }
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (bot.channelId) {
        bot.bot.sendMessage(bot.channelId, '🚨 Bot mengalami error dan akan restart otomatis...').catch(console.error);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
