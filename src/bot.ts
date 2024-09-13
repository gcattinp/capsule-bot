import { Telegraf, Context } from 'telegraf';
import Capsule, {
  WalletType,
  PregenIdentifierType,
  Environment,
} from '@usecapsule/server-sdk';
import {
  createCapsuleViemClient,
  createCapsuleAccount,
} from '@usecapsule/viem-v2-integration';
import { createPublicClient, http, formatUnits, Address } from 'viem';
import { base } from 'viem/chains';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN!);

const capsule = new Capsule(
  process.env.CAPSULE_ENVIRONMENT === 'production'
    ? Environment.PRODUCTION
    : Environment.DEVELOPMENT,
  process.env.CAPSULE_API_KEY!
);

function generateEmailFromTelegramId(userId: string): string {
  return `user_${userId}@telegram.example.com`;
}

const userShares: { [email: string]: string } = {};

function storeUserShare(email: string, userShare: string): void {
  userShares[email] = userShare;
}

function getUserShare(email: string): string | undefined {
  return userShares[email];
}

async function getOrCreateWalletAddress(
  ctx: Context
): Promise<{ address: string; email: string } | undefined> {
  const userId = ctx.from!.id.toString();
  const email = generateEmailFromTelegramId(userId);

  try {
    const userExists = await capsule.checkIfUserExists(email);
    if (!userExists) {
      await capsule.createUser(email);
      console.log(`Created new user with email: ${email}`);
    }

    let userShare: string | undefined;
    let walletAddress: string | undefined;

    const hasWallet = await capsule.hasPregenWallet(
      email,
      PregenIdentifierType.EMAIL
    );

    if (!hasWallet) {
      const newWallet = await capsule.createWalletPreGen(
        WalletType.EVM,
        email,
        PregenIdentifierType.EMAIL
      );
      walletAddress = newWallet.address ?? undefined;

      userShare = (await capsule.getUserShare()) ?? undefined;
      if (userShare) {
        storeUserShare(email, userShare);
      } else {
        throw new Error('Failed to retrieve user share after wallet creation.');
      }
    } else {
      userShare = getUserShare(email);

      if (!userShare) {
        userShare = (await capsule.getUserShare()) ?? undefined;
        if (userShare) {
          storeUserShare(email, userShare);
        } else {
          throw new Error('Failed to retrieve user share for existing wallet.');
        }
      }

      await capsule.setUserShare(userShare);

      const wallets = await capsule.getPregenWallets(
        email,
        PregenIdentifierType.EMAIL
      );
      walletAddress = wallets[0]?.address ?? undefined;
    }

    if (!walletAddress) {
      throw new Error('Failed to retrieve wallet address.');
    }

    return { address: walletAddress, email };
  } catch (error) {
    console.error(`Error in getOrCreateWalletAddress for ${email}:`, error);
    return undefined;
  }
}

bot.command('start', (ctx: Context) => {
  ctx.reply('Welcome! Use /wallet to create or view your wallet address.');
});

bot.command('wallet', async (ctx: Context) => {
  try {
    const result = await getOrCreateWalletAddress(ctx);
    if (result && result.address) {
      const { address } = result;

      const account = createCapsuleAccount(capsule);

      const viemWalletClient = createCapsuleViemClient(capsule, {
        account,
        chain: base,
        transport: http(process.env.RPC_URL!),
      });

      const publicClient = createPublicClient({
        chain: base,
        transport: http(process.env.RPC_URL!),
      });

      const formattedAddress = address.startsWith('0x') ? address : `0x${address}`;

      const walletAddress = formattedAddress as Address;

      const balance = await publicClient.getBalance({ address: walletAddress });
      const balanceInEther = formatUnits(balance, 18);

      ctx.reply(
        `Your wallet address: ${walletAddress}\n` +
          `ETH Balance: ${balanceInEther} ETH\n\n` +
          `Use this address for transactions within the bot.`
      );
    } else {
      ctx.reply(
        'An error occurred while processing your wallet. Please try again later.'
      );
    }
  } catch (error) {
    console.error('Error in wallet command:', error);
    ctx.reply(
      'An error occurred while processing your wallet. Please try again later.'
    );
  }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
