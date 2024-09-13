import { Telegraf } from 'telegraf';
import { createPublicClient, createWalletClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import { base } from 'viem/chains';
import { erc20Abi, maxUint256 } from 'viem';
import { ieBaseAbi } from '../abi/ieBaseAbi';

const BOT_TOKEN = process.env.BOT_TOKEN;
const RPC_URL = process.env.RPC_URL;

const CONTRACT_ADDRESS = '0x1e00cE4800dE0D0000640070006dfc5F93dD0ff9' as `0x${string}`;
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`;

if (!BOT_TOKEN || !RPC_URL) {
  console.error('Please set BOT_TOKEN and RPC_URL in your .env file');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const userAccounts: { [key: number]: `0x${string}` } = {};

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

function convertBigIntToString(obj: any): any {
  if (typeof obj === 'bigint') {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  } else if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, convertBigIntToString(value)])
    );
  }
  return obj;
}

async function interactWithIntentsEngine(privateKey: `0x${string}`, intentString: string): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });

  try {
    const preview = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: ieBaseAbi,
      functionName: 'previewCommand',
      args: [intentString],
    });

    let value = BigInt(0);
    const token = (preview as any)[3];

    if (token === ETH_ADDRESS) {
      value = (preview as any)[1];
    } else {
      const allowance = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account.address, CONTRACT_ADDRESS],
      });

      if (allowance < (preview as any)[1]) {
        const approveTxHash = await walletClient.writeContract({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [CONTRACT_ADDRESS, maxUint256],
        });

        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      }
    }

    const commandTxHash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: ieBaseAbi,
      functionName: 'command',
      value,
      args: [intentString],
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: commandTxHash,
    });

    const previewString = JSON.stringify(convertBigIntToString(preview));

    const baseScanLink = `https://basescan.org/tx/${receipt.transactionHash}`;

    return `Preview: ${previewString}\nTransaction successful: ${receipt.transactionHash}\nView on BaseScan: ${baseScanLink}`;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return 'An unknown error occurred';
  }
}

function createEOA(): { address: `0x${string}`; privateKey: `0x${string}` } {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAddress(privateKey);
  return { address, privateKey };
}

bot.command('start', (ctx) => {
  ctx.reply('Welcome! Use /createaccount to generate a new Ethereum account.');
});

bot.command('createaccount', (ctx) => {
  const chatId = ctx.chat.id;
  const account = createEOA();
  userAccounts[chatId] = account.privateKey;
  ctx.reply(`New account created!\nAddress: ${account.address}\n`);
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  if (text.startsWith('/')) return;

  if (!userAccounts[chatId]) {
    ctx.reply('Please create an account first using /createaccount');
    return;
  }

  await ctx.reply('Processing your request...');
  const result = await interactWithIntentsEngine(userAccounts[chatId], text);
  await ctx.reply(result);
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply('An error occurred while processing your request.');
});

bot.launch().then(() => {
  console.log('Bot is running...');
}).catch((error) => {
  console.error('Failed to start the bot:', error);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
