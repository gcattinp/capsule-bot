require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const rateLimit = require('telegraf-ratelimit');

const bot = new Telegraf(process.env.BOT_TOKEN);

const chatHistories = new Map();
const welcomedUsers = new Set();

const limitConfig = {
  window: 3600000,
  limit: 33,
  onLimitExceeded: (ctx) => ctx.reply('Rate limit exceeded. Please wait for 1 hour before sending another message.'),
};

bot.use(rateLimit(limitConfig));

async function queryLLM(messages) {
  try {
    const response = await axios.post('http://nani.ooo/api/chat', {
      messages: messages
    }, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY },
      responseType: 'stream'
    });

    let fullResponse = '';

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        const chunkStr = chunk.toString('utf-8');
        fullResponse += chunkStr;
      });

      response.data.on('end', () => {
        resolve(fullResponse);
      });

      response.data.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error('Error querying LLM:', error);
    throw error;
  }
}

function splitMessage(text, maxLength = 4000) {
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, maxLength));
    text = text.slice(maxLength);
  }
  return chunks;
}

bot.command('start', (ctx) => {
  const chatId = ctx.chat.id;
  const welcomeMessage = "Welcome! I'm your AI assistant. Feel free to ask me anything. " +
    "If you want to start a new conversation at any time, just type /new.";
  ctx.reply(welcomeMessage).catch(error => console.error('Error sending welcome message:', error));
  welcomedUsers.add(chatId);
  chatHistories.set(chatId, []);
});

bot.command('new', (ctx) => {
  const chatId = ctx.chat.id;
  chatHistories.set(chatId, []);
  ctx.reply('Starting a new conversation. Your chat history has been cleared. What would you like to talk about?')
    .catch(error => console.error('Error sending new conversation message:', error));
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const userMessage = ctx.message.text;

  if (!chatHistories.has(chatId)) {
    chatHistories.set(chatId, []);
    if (!welcomedUsers.has(chatId)) {
      ctx.reply("Welcome! I'm your AI assistant. Feel free to ask me anything. " +
        "If you want to start a new conversation at any time, just type /new.")
        .catch(error => console.error('Error sending welcome message:', error));
      welcomedUsers.add(chatId);
    }
  }

  chatHistories.get(chatId).push({ role: "user", content: userMessage });

  let previewMessage;
  let previewTimer;

  const sendPreviewMessage = async () => {
    try {
      previewMessage = await ctx.reply('Processing your request... Please wait.');
    } catch (error) {
      console.error('Error sending preview message:', error);
    }
  };

  previewTimer = setTimeout(sendPreviewMessage, 3000);

  try {
    const llmResponse = await queryLLM(chatHistories.get(chatId));

    clearTimeout(previewTimer);

    if (previewMessage) {
      ctx.telegram.deleteMessage(ctx.chat.id, previewMessage.message_id).catch(() => { });
      previewMessage = null;
    }

    chatHistories.get(chatId).push({ role: "assistant", content: llmResponse });

    const chunks = splitMessage(llmResponse);
    for (const chunk of chunks) {
      await ctx.reply(chunk).catch(error => console.error('Error sending response chunk:', error));
    }
  } catch (error) {
    console.error('Error in bot:', error);

    if (previewMessage) {
      ctx.telegram.deleteMessage(ctx.chat.id, previewMessage.message_id).catch(() => { });
    }

    ctx.reply('Sorry, I encountered an error while processing your request.')
      .catch(error => console.error('Error sending error message:', error));
  } finally {
    clearTimeout(previewTimer);
  }
});

bot.launch({ dropPendingUpdates: true });

console.log('Bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
