// Untuk mengirim ke channel Telegram
class ChannelManager {
    constructor(bot) {
        this.bot = bot;
        this.channelId = process.env.CHANNEL_ID; 1003126108620
    }

    async sendToChannel(message) {
        try {
            await this.bot.sendMessage(this.channelId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        } catch (error) {
            console.error('Error sending to channel:', error);
        }
    }

    formatWhaleMessage(trade, value, marketData) {
        const side = trade.side === 'A' ? 'LONG 📈' : 'SHORT 📉';
        const emoji = trade.side === 'A' ? '🟢' : '🔴';
        
        return `
🐋 **WHALE SPOTTED** ${emoji}

**${trade.coin}-PERP ${side}**

💰 **Trade Value:** $${value.toLocaleString()}
📊 **Size:** ${parseFloat(trade.sz).toFixed(2)} ${trade.coin}
💵 **Price:** $${parseFloat(trade.px).toLocaleString()}

📈 **Market Data:**
• Mark Price: $${marketData.markPx}
• 24h Volume: $${marketData.volume24h}
• Funding Rate: ${marketData.fundingRate}%

⏰ **Time:** ${new Date(trade.time).toLocaleString()}

[View on Hyperliquid](https://app.hyperliquid.xyz/trade/${trade.coin})

#HyperliquidWhale #${trade.coin} #${side.split(' ')[0]}
        `;
    }
}

module.exports = ChannelManager;
