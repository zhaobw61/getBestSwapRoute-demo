import { Logger } from '@ethersproject/logger';
import { flags } from '@oclif/command';
import { Protocol } from '@uniswap/router-sdk';
import {
  Currency,
  CurrencyAmount,
  Fraction,
  Percent,
  Token,
  TradeType,
} from '@uniswap/sdk-core';
import dotenv from 'dotenv';
import _ from 'lodash';

import { FeeAmount } from '@uniswap/v3-sdk';
import { BigNumber } from 'ethers';
import { allRoutesWithValidQuotes } from '../../allRoutesWithValidQuotes-1';
import routingConfig from '../../routingConfig.json';
import {
  ID_TO_CHAIN_ID,
  MapWithLowerCaseKey,
  nativeOnChain,
  parseAmount,
  RouteWithValidQuote,
  //SwapRoute,
  SwapType,
} from '../../src';
import { PortionProvider } from '../../src/providers/portion-provider';
import { getBestSwapRoute } from '../../src/routers/alpha-router/functions/best-swap-route';
import {
  computeAllV2Routes,
  computeAllV3Routes,
} from '../../src/routers/alpha-router/functions/compute-all-routes';
import { NATIVE_NAMES_BY_ID, TO_PROTOCOL } from '../../src/util';
import { BaseCommand } from '../base-command';
//import { Pair } from '@uniswap/v2-sdk';
//import { UniversalRouterVersion } from '@uniswap/universal-router-sdk';

dotenv.config();

Logger.globalLogger();
Logger.setLogLevel(Logger.levels.DEBUG);

function getAmountDistribution(
  amount: CurrencyAmount<Currency>,
  distributionPercent: number
): [number[], CurrencyAmount<Currency>[]] {
  const percents: number[] = [];
  const amounts: CurrencyAmount<Currency>[] = [];

  for (let i = 1; i <= 100 / distributionPercent; i++) {
    percents.push(i * distributionPercent);
    amounts.push(amount.multiply(new Fraction(i * distributionPercent, 100)));
  }

  return [percents, amounts];
}
export class Quote extends BaseCommand {
  static description = 'Uniswap Smart Order Router CLI';

  static flags = {
    ...BaseCommand.flags,
    version: flags.version({ char: 'v' }),
    help: flags.help({ char: 'h' }),
    tokenIn: flags.string({ char: 'i', required: true }),
    tokenOut: flags.string({ char: 'o', required: true }),
    recipient: flags.string({ required: false }),
    amount: flags.string({ char: 'a', required: true }),
    exactIn: flags.boolean({ required: false }),
    exactOut: flags.boolean({ required: false }),
    protocols: flags.string({ required: false }),
    forceCrossProtocol: flags.boolean({ required: false, default: false }),
    forceMixedRoutes: flags.boolean({
      required: false,
      default: false,
    }),
    simulate: flags.boolean({ required: false, default: false }),
    debugRouting: flags.boolean({ required: false, default: true }),
    enableFeeOnTransferFeeFetching: flags.boolean({
      required: false,
      default: false,
    }),
    requestBlockNumber: flags.integer({ required: false }),
    gasToken: flags.string({ required: false }),
  };

  async run() {
    const { flags } = this.parse(Quote);
    const {
      tokenIn: tokenInStr,
      tokenOut: tokenOutStr,
      amount: amountStr,
      exactIn,
      exactOut,
      recipient,
      //debug,
      topN,
      topNTokenInOut,
      topNSecondHop,
      topNSecondHopForTokenAddressRaw,
      topNWithEachBaseToken,
      topNWithBaseToken,
      topNWithBaseTokenInSet,
      topNDirectSwaps,
      maxSwapsPerPath,
      minSplits,
      maxSplits,
      distributionPercent,
      chainId: chainIdNumb,
      protocols: protocolsStr,
      forceCrossProtocol,
      forceMixedRoutes,
      //simulate,
      debugRouting,
      enableFeeOnTransferFeeFetching,
      //requestBlockNumber,
      gasToken,
    } = flags;

    const topNSecondHopForTokenAddress = new MapWithLowerCaseKey();
    topNSecondHopForTokenAddressRaw.split(',').forEach((entry) => {
      if (entry != '') {
        const entryParts = entry.split('|');
        if (entryParts.length != 2) {
          throw new Error(
            'flag --topNSecondHopForTokenAddressRaw must be in format tokenAddress|topN,...'
          );
        }
        const topNForTokenAddress: number = Number(entryParts[1]!);
        topNSecondHopForTokenAddress.set(entryParts[0]!, topNForTokenAddress);
      }
    });

    if ((exactIn && exactOut) || (!exactIn && !exactOut)) {
      throw new Error('Must set either --exactIn or --exactOut.');
    }

    let protocols: Protocol[] = [];
    if (protocolsStr) {
      try {
        protocols = _.map(protocolsStr.split(','), (protocolStr) =>
          TO_PROTOCOL(protocolStr)
        );
      } catch (err) {
        throw new Error(
          `Protocols invalid. Valid options: ${Object.values(Protocol)}`
        );
      }
    }

    const chainId = ID_TO_CHAIN_ID(chainIdNumb);

    //const log = this.logger;
    const tokenProvider = this.tokenProvider;
    const router = this.router;

    // if the tokenIn str is 'ETH' or 'MATIC' or in NATIVE_NAMES_BY_ID
    const tokenIn: Currency = NATIVE_NAMES_BY_ID[chainId]!.includes(tokenInStr)
      ? nativeOnChain(chainId)
      : (await tokenProvider.getTokens([tokenInStr])).getTokenByAddress(
          tokenInStr
        )!;

    const tokenOut: Currency = NATIVE_NAMES_BY_ID[chainId]!.includes(
      tokenOutStr
    )
      ? nativeOnChain(chainId)
      : (await tokenProvider.getTokens([tokenOutStr])).getTokenByAddress(
          tokenOutStr
        )!;

    if (exactIn) {
      const amountIn = parseAmount(amountStr, tokenIn);
      /*
      const currencyA = CurrencyAmount.fromRawAmount(tokenIn as Token, amountStr);
      const currencyB = CurrencyAmount.fromRawAmount(tokenOut as Token, amountStr);
      */
      const v2PoolProvider = router.getV2PoolProvider();
      const v3PoolProvider = router.getV3PoolProvider();
      const v2Accessor = await v2PoolProvider.getPools([
        [tokenIn as Token, tokenOut as Token],
      ]);
      const v3Accessor = await v3PoolProvider.getPools([
        [tokenIn as Token, tokenOut as Token, FeeAmount.MEDIUM],
      ]);
      const v2Pools = v2Accessor.getAllPools();
      const v3Pools = v3Accessor.getAllPools();
      const v2Routes = computeAllV2Routes(
        tokenIn as Token,
        tokenOut as Token,
        v2Pools,
        1
      );
      const v3Routes = computeAllV3Routes(
        tokenIn as Token,
        tokenOut as Token,
        v3Pools,
        1
      );
      const v2Quoter = router.getV2Quoter();
      const v3Quoter = router.getV3Quoter();
      const distributionPercent = 50;
      const [percents, amounts] = getAmountDistribution(
        amountIn,
        distributionPercent
      );
      const maxSplits = 2;
      const minSplits = 1;
      const dummyConfig = {
        blockNumber: this.blockNumber - 10,
        v2PoolSelection: {
          topN,
          topNTokenInOut,
          topNSecondHop,
          topNWithEachBaseToken,
          topNWithBaseToken,
          topNDirectSwaps,
        },
        v3PoolSelection: {
          topN,
          topNTokenInOut,
          topNSecondHop,
          topNWithEachBaseToken,
          topNWithBaseToken,
          topNDirectSwaps,
        },
        v4PoolSelection: {
          topN,
          topNTokenInOut,
          topNSecondHop,
          topNWithEachBaseToken,
          topNWithBaseToken,
          topNDirectSwaps,
        },
        maxSwapsPerPath,
        minSplits,
        maxSplits,
        distributionPercent,
        protocols,
        forceCrossProtocol,
        forceMixedRoutes,
        debugRouting,
        enableFeeOnTransferFeeFetching,
        gasToken,
      };
      const v2quotes = await v2Quoter.getQuotes(
        v2Routes,
        amounts,
        percents,
        tokenOut as Token,
        TradeType.EXACT_INPUT,
        dummyConfig,
        undefined,
        undefined,
        BigNumber.from(1e6)
      );
      console.log(v2quotes);

      const { v3GasModel } = await router.getGasModel(
        amountIn,
        tokenOut as Currency,
        dummyConfig
      );
      const v3quotes = await v3Quoter.getQuotes(
        v3Routes,
        amounts,
        percents,
        tokenOut as Token,
        TradeType.EXACT_INPUT,
        dummyConfig,
        undefined,
        v3GasModel
      );
      console.log(v3quotes);

      const portionProvider = new PortionProvider();

      function convertToRouteWithValidQuote(route: any): RouteWithValidQuote {
        try {
          // 创建 Token 实例
          const inputToken = new Token(
            route.route.input.chainId,
            route.route.input.address,
            route.route.input.decimals,
            route.route.input.symbol,
            route.route.input.name
          );

          const outputToken = new Token(
            route.route.output.chainId,
            route.route.output.address,
            route.route.output.decimals,
            route.route.output.symbol,
            route.route.output.name
          );

          // 处理 pools
          const pools = route.route.pools.map((pool: any) => {
            const token0 = new Token(
              pool.token0.chainId,
              pool.token0.address,
              pool.token0.decimals,
              pool.token0.symbol,
              pool.token0.name
            );

            const token1 = new Token(
              pool.token1.chainId,
              pool.token1.address,
              pool.token1.decimals,
              pool.token1.symbol,
              pool.token1.name
            );

            return new Pool(
              token0,
              token1,
              pool.fee,
              BigNumber.from('79228162514264337593543950336'), // 2^96
              BigNumber.from('1000000000000000000'), // 1e18
              pool.tickCurrent || 0
            );
          });

          // 创建 V3Route
          const v3Route = new V3Route(
            route.tokenPath.map(
              (token: any) =>
                new Token(
                  token.chainId,
                  token.address,
                  token.decimals,
                  token.symbol,
                  token.name
                )
            ),
            pools,
            inputToken,
            outputToken
          );

          // 创建 RouteWithValidQuote
          return new V3RouteWithValidQuote(
            v3Route,
            CurrencyAmount.fromRawAmount(
              new Token(
                route.quote.currency.chainId,
                route.quote.currency.address,
                route.quote.currency.decimals,
                route.quote.currency.symbol
              ),
              route.quote.numerator?.[0] || '0'
            ),
            CurrencyAmount.fromRawAmount(
              new Token(
                route.quoteAdjustedForGas.currency.chainId,
                route.quoteAdjustedForGas.currency.address,
                route.quoteAdjustedForGas.currency.decimals,
                route.quoteAdjustedForGas.currency.symbol
              ),
              route.quoteAdjustedForGas.numerator?.[0] || '0'
            ),
            BigNumber.from(route.gasEstimate?.hex || '0'),
            CurrencyAmount.fromRawAmount(
              new Token(
                route.gasCostInToken.currency.chainId,
                route.gasCostInToken.currency.address,
                route.gasCostInToken.currency.decimals,
                route.gasCostInToken.currency.symbol
              ),
              route.gasCostInToken.numerator?.[0] || '0'
            ),
            CurrencyAmount.fromRawAmount(
              new Token(
                route.gasCostInUSD.currency.chainId,
                route.gasCostInUSD.currency.address,
                route.gasCostInUSD.currency.decimals,
                route.gasCostInUSD.currency.symbol
              ),
              route.gasCostInUSD.numerator?.[0] || '0'
            ),
            route.percent || 0,
            new Token(
              route.quoteToken.chainId,
              route.quoteToken.address,
              route.quoteToken.decimals,
              route.quoteToken.symbol
            ),
            route.tradeType,
            CurrencyAmount.fromRawAmount(
              new Token(
                route.amount.currency.chainId,
                route.amount.currency.address,
                route.amount.currency.decimals,
                route.amount.currency.symbol
              ),
              route.amount.numerator?.[0] || '0'
            ),
            BigNumber.from(route.rawQuote?.hex || '0'),
            (route.sqrtPriceX96AfterList || []).map((price: any) =>
              BigNumber.from(price?.hex || '0')
            ),
            route.initializedTicksCrossedList || [],
            BigNumber.from(route.quoterGasEstimate?.hex || '0'),
            route.gasModel || null
          );
        } catch (error) {
          console.error('Error converting route:', error);
          return null;
        }
      }
      // 转换路由数据
      const routes = allRoutesWithValidQuotes
        .map(convertToRouteWithValidQuote)
        .filter((route): route is RouteWithValidQuote => route !== null);
      const bestResult = await getBestSwapRoute(
        amountIn,
        percents,
        routes as any,
        TradeType.EXACT_INPUT,
        8453,
        routingConfig as any,
        portionProvider,
        v3GasModel as any
      );
      console.log('Best result: ', bestResult);
    } else {
      const amountOut = parseAmount(amountStr, tokenOut);
      await router.route(
        amountOut,
        tokenIn,
        TradeType.EXACT_OUTPUT,
        recipient
          ? {
              type: SwapType.SWAP_ROUTER_02,
              deadline: 100,
              recipient,
              slippageTolerance: new Percent(5, 10_000),
            }
          : undefined,
        {
          blockNumber: this.blockNumber - 10,
          v3PoolSelection: {
            topN,
            topNTokenInOut,
            topNSecondHop,
            topNSecondHopForTokenAddress,
            topNWithEachBaseToken,
            topNWithBaseToken,
            topNWithBaseTokenInSet,
            topNDirectSwaps,
          },
          maxSwapsPerPath,
          minSplits,
          maxSplits,
          distributionPercent,
          protocols,
          forceCrossProtocol,
          forceMixedRoutes,
          debugRouting,
          enableFeeOnTransferFeeFetching,
          gasToken,
        }
      );
    }
  }
}
