import { request, gql } from 'graphql-request';
import dotenv from 'dotenv';
dotenv.config();

const BITQUERY_ENDPOINT = 'https://graphql.bitquery.io';
const BITQUERY_API_KEY = process.env.BITQUERY_API_KEY;

/**
 * Retrieves early buyers and sellers for a given token within a block range,
 * and aggregates detailed trade information per wallet.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {number} startBlock - The starting block (e.g. liquidity pool creation block).
 * @param {number} endBlock - The ending block (e.g. startBlock + 1000).
 * @returns {Promise<Array>} Array of wallet objects with trade and PNL details.
 */
export async function getEarlyBuyersAndSellers(tokenAddress, startBlock, endBlock) {
  if (!BITQUERY_API_KEY) {
    console.warn('Bitquery API key not provided. Skipping Bitquery call.');
    return [];
  }

  const query = gql`
    query EarlyBuyersSellers($tokenAddress: String!, $startBlock: Int!, $endBlock: Int!) {
      ethereum(network: ethereum) {
        dexTrades(
          baseCurrency: { is: $tokenAddress }
          options: { limit: 1000, asc: "block.height" }
          block: { height: { gte: $startBlock, lt: $endBlock } }
        ) {
          block {
            height
            timestamp {
              time
            }
          }
          transaction {
            hash
          }
          exchangeAddress
          smartContract {
            address {
              address
            }
          }
          buyAmount
          sellAmount
          buyCurrency {
            symbol
            address
          }
          sellCurrency {
            symbol
            address
          }
          quotePrice
        }
      }
    }
  `;

  const variables = { tokenAddress, startBlock, endBlock };

  try {
    const response = await request(
      BITQUERY_ENDPOINT,
      query,
      variables,
      { 'X-API-KEY': BITQUERY_API_KEY }
    );
    const trades = response?.ethereum?.dexTrades || [];

    // Aggregate trades by wallet address.
    const walletMap = {};

    trades.forEach(trade => {
      // Calculate how many blocks after liquidity pool creation.
      const blocksAfterCreation = trade.block?.height && startBlock
        ? (trade.block.height - startBlock)
        : null;

      // Process buyer side (sniped transactions)
      if (trade.exchangeAddress) {
        const buyer = trade.exchangeAddress;
        if (!walletMap[buyer]) {
          walletMap[buyer] = {
            walletAddress: buyer,
            snipedTransactions: [],
            sellTransactions: [],
            totalTokensSniped: 0,
            totalSnipedUsd: 0,
            totalTokensSold: 0,
            totalSoldUsd: 0
          };
        }
        const buyUsd = Number(trade.buyAmount) * Number(trade.quotePrice);
        walletMap[buyer].snipedTransactions.push({
          transactionHash: trade.transaction.hash,
          transactionTimestamp: trade.block.timestamp.time,
          blocksAfterCreation,
          buyAmount: Number(trade.buyAmount),
          buyUsd
        });
        walletMap[buyer].totalTokensSniped += Number(trade.buyAmount);
        walletMap[buyer].totalSnipedUsd += buyUsd;
      }

      // Process seller side (sell transactions)
      const seller = trade.smartContract?.address?.address;
      if (seller) {
        if (!walletMap[seller]) {
          walletMap[seller] = {
            walletAddress: seller,
            snipedTransactions: [],
            sellTransactions: [],
            totalTokensSniped: 0,
            totalSnipedUsd: 0,
            totalTokensSold: 0,
            totalSoldUsd: 0
          };
        }
        const sellUsd = Number(trade.sellAmount) * Number(trade.quotePrice);
        walletMap[seller].sellTransactions.push({
          transactionHash: trade.transaction.hash,
          transactionTimestamp: trade.block.timestamp.time,
          blocksAfterCreation,
          sellAmount: Number(trade.sellAmount),
          sellUsd
        });
        walletMap[seller].totalTokensSold += Number(trade.sellAmount);
        walletMap[seller].totalSoldUsd += sellUsd;
      }
    });

    // Convert the aggregated data into an array with computed PNL and balance.
    const walletData = Object.values(walletMap).map(wallet => {
      const totalSnipedTransactions = wallet.snipedTransactions.length;
      const totalSellTransactions = wallet.sellTransactions.length;
      const currentBalance = wallet.totalTokensSniped - wallet.totalTokensSold;
      const realizedProfitUsd = wallet.totalSoldUsd - wallet.totalSnipedUsd;
      const realizedProfitPercentage = wallet.totalSnipedUsd > 0
        ? (realizedProfitUsd / wallet.totalSnipedUsd) * 100
        : 0;
      return {
        walletAddress: wallet.walletAddress,
        snipedTransactions: wallet.snipedTransactions,
        sellTransactions: wallet.sellTransactions,
        totalSnipedTransactions,
        totalSellTransactions,
        totalTokensSniped: wallet.totalTokensSniped,
        totalSnipedUsd: wallet.totalSnipedUsd,
        totalTokensSold: wallet.totalTokensSold,
        totalSoldUsd: wallet.totalSoldUsd,
        currentBalance,
        realizedProfitUsd,
        realizedProfitPercentage,
        // Optionally, if you want to compute currentBalanceUsdValue later,
        // you can do so in the main function using the token's price.
      };
    });

    console.log(`Processed ${walletData.length} sniper wallets.`);
    return walletData;
  } catch (error) {
    console.error('Error fetching early buyers and sellers:', error.message);
    return [];
  }
}
