import { Telegraf, Context } from 'telegraf';
import Capsule, {
  WalletType,
  PregenIdentifierType,
  Environment,
} from "@usecapsule/server-sdk";
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN!);
const capsule = new Capsule(
  process.env.CAPSULE_ENVIRONMENT === 'production' ? Environment.PRODUCTION : Environment.DEVELOPMENT,
  process.env.CAPSULE_API_KEY!
);

function generateEmailFromTelegramId(userId: string): string {
  return `user_${userId}@telegram.example.com`;
}

async function getOrCreateWalletAddress(ctx: Context): Promise<string | undefined> {
  const userId = ctx.from!.id.toString();
  const email = generateEmailFromTelegramId(userId);

  try {
    const userExists = await capsule.checkIfUserExists(email);
    if (!userExists) {
      await capsule.createUser(email);
      console.log(`Created new user with email: ${email}`);
    }
    const hasWallet = await capsule.hasPregenWallet(email, PregenIdentifierType.EMAIL);
    if (hasWallet) {
      const wallets = await capsule.getPregenWallets(email, PregenIdentifierType.EMAIL);
      return wallets[0]?.address ?? undefined;
    } else {
      const newWallet = await capsule.createWalletPreGen(
        WalletType.EVM,
        email,
        PregenIdentifierType.EMAIL
      );

      const userShare = await capsule.getUserShare();
      if (userShare) {
        await ctx.telegram.setMyCommands([
          { command: 'start', description: 'Start the bot' },
          { command: 'wallet', description: 'View your wallet' }
        ], {
          scope: { type: 'chat', chat_id: ctx.chat!.id }
        });

        await ctx.telegram.setMyCommands([
          { command: `user_share_${userId}`, description: userShare }
        ], {
          scope: { type: 'chat', chat_id: ctx.chat!.id }
        });
      }
      return newWallet.address ?? undefined;
    }
  } catch (error) {
    console.error(`Error in getOrCreateWalletAddress for ${email}:`, error);
    return undefined;
  }
}

bot.command('start', (ctx) => {
  ctx.reply('Welcome! Use /wallet to create or view your wallet address.');
});

bot.command('wallet', async (ctx) => {
  try {
    const address = await getOrCreateWalletAddress(ctx);
    if (address) {
      ctx.reply(`Your wallet address: ${address}\n\nUse this address for transactions within the bot.`);
    } else {
      ctx.reply('An error occurred while processing your wallet. Please try again later.');
    }
  } catch (error) {
    console.error('Error in wallet command:', error);
    ctx.reply('An error occurred while processing your wallet. Please try again later.');
  }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
