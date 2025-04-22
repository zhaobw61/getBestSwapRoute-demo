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
import { AllowanceTransfer, permit2Address, PermitSingle } from '@uniswap/permit2-sdk';
import dotenv from 'dotenv';
import _ from 'lodash';

import { FeeAmount } from '@uniswap/v3-sdk';
import { BigNumber, Wallet } from 'ethers';
import routingConfig from '../../routingConfig.json';
import {
  ID_TO_CHAIN_ID,
  IGasModel,
  L1ToL2GasCosts,
  MapWithLowerCaseKey,
  MethodParameters,
  nativeOnChain,
  parseAmount,
  //SwapRoute,
  SwapType,
  USDC_BASE,
  V2RouteWithValidQuote,
  V3RouteWithValidQuote,
} from '../../src';
import { PortionProvider } from '../../src/providers/portion-provider';
import { getBestSwapRoute } from '../../src/routers/alpha-router/functions/best-swap-route';
import {
  computeAllV2Routes,
  computeAllV3Routes,
} from '../../src/routers/alpha-router/functions/compute-all-routes';
import { NATIVE_NAMES_BY_ID, TO_PROTOCOL } from '../../src/util';
import {
  buildSwapMethodParameters,
  buildTrade,
} from '../../src/util/methodParameters';
import { BaseCommand } from '../base-command';
import { UNIVERSAL_ROUTER_ADDRESS, UniversalRouterVersion } from '@uniswap/universal-router-sdk';
//import { Permit2 } from '../../src/types/other/Permit2';
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
      console.log('177-----');
      const v2Accessor = await v2PoolProvider.getPools([
        [tokenIn as Token, tokenOut as Token],
      ]);
      console.log('182-----');
      const v3Accessor = await v3PoolProvider.getPools([
        [tokenIn as Token, tokenOut as Token, FeeAmount.MEDIUM],
      ]);
      console.log('183-----');
      const v2Pools = v2Accessor.getAllPools();
      console.log('v2Pools');
      const v3Pools = v3Accessor.getAllPools();
      console.log('v3Pools');
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
      const distributionPercent = 1; //50
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

      const v2GasModel = new V2GasModel();
      const v2quotes = await v2Quoter.getQuotes(
        v2Routes,
        amounts,
        percents,
        tokenOut as Token,
        TradeType.EXACT_INPUT,
        dummyConfig,
        undefined,
        v2GasModel,
        BigNumber.from(1e6)
      );

      const v3GasModel = new V3GasModel();
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

      console.log('v2quotes');
      v2quotes.routesWithValidQuotes.forEach(route => {
        console.log(route.percent, route.amount.toSignificant(), route.quote.toSignificant());
      });

      console.log('v3quotes');
      v3quotes.routesWithValidQuotes.forEach(route => {
        console.log(route.percent, route.amount.toSignificant(), route.quote.toSignificant());
      });

      const portionProvider = new PortionProvider();

      // 转换路由数据
      // const routes = allRoutesWithValidQuotes
      //   .map(convertToRouteWithValidQuote)
      //   .filter((route): route is RouteWithValidQuote => route !== null);
      const allRoutesWithValidQuotesTemp = [
        ...v2quotes.routesWithValidQuotes,
        //...v3quotes.routesWithValidQuotes,
      ];
      const bestResult = await getBestSwapRoute(
        amountIn,
        percents,
        allRoutesWithValidQuotesTemp as any,
        TradeType.EXACT_INPUT,
        8453,
        routingConfig as any,
        portionProvider,
        v3GasModel as any
      );
      console.log('Best result: ', bestResult?.routes);
      // ------
      function determineCurrencyInOutFromTradeType(
        tradeType: TradeType,
        amount: CurrencyAmount<Currency>,
        quoteCurrency: Currency
      ) {
        if (tradeType === TradeType.EXACT_INPUT) {
          return {
            currencyIn: amount.currency,
            currencyOut: quoteCurrency,
          };
        } else {
          return {
            currencyIn: quoteCurrency,
            currencyOut: amount.currency,
          };
        }
      }
      const { currencyIn, currencyOut } = determineCurrencyInOutFromTradeType(
        TradeType.EXACT_INPUT,
        amountIn,
        tokenOut
      );
      let routeAmounts = bestResult?.routes;
      // Build Trade object that represents the optimal swap.
      const trade = buildTrade<typeof TradeType.EXACT_INPUT>(
        currencyIn,
        currencyOut,
        TradeType.EXACT_INPUT,
        routeAmounts as any
      );
      console.log('trade', trade);
      let methodParameters: MethodParameters | undefined;
      const chainId = 8453; // 以太坊主网
      const spender = UNIVERSAL_ROUTER_ADDRESS(UniversalRouterVersion.V2_0, chainId); // UniversalRouter地址
      const wallet = new Wallet("0xc84e2475d76db871f44a7fc8e01f9a10d3e343452206202eaf5ad6b3b0716f2a");
      const { permitData, signature } = await generatePermit2Signature(
        wallet,
        (tokenIn as Token).address,
        amountIn.numerator.toString(),
        spender,
        chainId
      );
      console.log('permitData', permitData);
      let swapConfig: any = {
        type: SwapType.UNIVERSAL_ROUTER,
        deadlineOrPreviousBlockhash: 10000000000000,
        //recipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        slippageTolerance: new Percent(5, 100),
        simulate: undefined,
        //useRouterBalance: true,
        version: '2.0',
        inputTokenPermit: permitData,
      };
      console.log('amountIn', amountIn);
      methodParameters = buildSwapMethodParameters(trade, swapConfig, chainId);
      console.log('methodParameters', methodParameters, "signature", signature);
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

class V3GasModel implements IGasModel<V3RouteWithValidQuote> {
  public estimateGasCost(routeWithValidQuote: V3RouteWithValidQuote): {
    gasEstimate: BigNumber;
    gasCostInToken: CurrencyAmount<Currency>;
    gasCostInUSD: CurrencyAmount<Currency>;
    gasCostInGasToken?: CurrencyAmount<Currency>;
  } {
    const token = routeWithValidQuote.quoteToken;
    const usd = USDC_BASE;
    return {
      gasEstimate: BigNumber.from(1),
      gasCostInToken: CurrencyAmount.fromRawAmount(token, 0),
      gasCostInUSD: CurrencyAmount.fromRawAmount(usd, 0),
    };
  }

  public calculateL1GasFees(
    routes: V3RouteWithValidQuote[]
  ): Promise<L1ToL2GasCosts> {
    const token = routes[0]!.quoteToken;
    const usd = USDC_BASE;
    return Promise.resolve({
      gasUsedL1: BigNumber.from(1),
      gasUsedL1OnL2: BigNumber.from(1),
      gasCostL1USD: CurrencyAmount.fromRawAmount(usd, 0),
      gasCostL1QuoteToken: CurrencyAmount.fromRawAmount(token, 0),
    });
  }
}

class V2GasModel implements IGasModel<V2RouteWithValidQuote> {
  public estimateGasCost(routeWithValidQuote: V2RouteWithValidQuote): {
    gasEstimate: BigNumber;
    gasCostInToken: CurrencyAmount<Currency>;
    gasCostInUSD: CurrencyAmount<Currency>;
    gasCostInGasToken?: CurrencyAmount<Currency>;
  } {
    const token = routeWithValidQuote.quoteToken;
    const usd = USDC_BASE;
    return {
      gasEstimate: BigNumber.from(1),
      gasCostInToken: CurrencyAmount.fromRawAmount(token, 0),
      gasCostInUSD: CurrencyAmount.fromRawAmount(usd, 0),
    };
  }

  public calculateL1GasFees(
    routes: V2RouteWithValidQuote[]
  ): Promise<L1ToL2GasCosts> {
    const token = routes[0]!.quoteToken;
    const usd = USDC_BASE;
    return Promise.resolve({
      gasUsedL1: BigNumber.from(1),
      gasUsedL1OnL2: BigNumber.from(1),
      gasCostL1USD: CurrencyAmount.fromRawAmount(usd, 0),
      gasCostL1QuoteToken: CurrencyAmount.fromRawAmount(token, 0),
    });
  }
}

export async function generatePermit2Signature(
  wallet: Wallet,
  tokenAddress: string,
  amount: string,
  spender: string,
  chainId: number,
  nonce: string = '0',
  deadline: number = 100000
): Promise<{
  domain: any;
  types: any;
  values: any;
  signature: string;
  permitData: PermitSingle & { signature: string };
}> {
  // 计算过期时间
  const now = Math.floor(Date.now() / 1000);
  const expiration = (now + deadline).toString();
  const sigDeadline = expiration;

  // 创建PermitSingle对象
  const permit: PermitSingle = {
    details: {
      token: tokenAddress,
      amount: amount,
      expiration: expiration,
      nonce: nonce,
    },
    spender: spender,
    sigDeadline: sigDeadline,
  };

  // 使用AllowanceTransfer获取签名数据
  const { domain, types, values } = AllowanceTransfer.getPermitData(
    permit,
    permit2Address(chainId),
    chainId
  );

  // 使用钱包签名
  const signature = await wallet._signTypedData(domain, types, values);

  // 返回签名及相关数据
  return {
    domain,
    types,
    values,
    signature,
    permitData: {
      ...permit,
      signature,
    }
  };
}

/**
 * 使用示例:
 * 
 * // 引入必要的依赖
 * import { Wallet } from 'ethers';
 * import { UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk';
 * 
 * // 1. 创建钱包实例
 * const wallet = new Wallet(privateKey);
 * 
 * // 2. 设置参数
 * const tokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC合约地址
 * const amount = '1000000'; // 1 USDC (6位小数)
 * const spender = UNIVERSAL_ROUTER_ADDRESS(版本, 链ID); // UniversalRouter地址
 * const chainId = 1; // 以太坊主网
 * 
 * // 3. 生成签名
 * const { permitData, signature } = await generatePermit2Signature(
 *   wallet,
 *   tokenAddress,
 *   amount,
 *   spender,
 *   chainId
 * );
 * 
 * // 4. 使用签名数据执行swap
 * const swapOptions = {
 *   type: SwapType.UNIVERSAL_ROUTER,
 *   recipient: wallet.address,
 *   slippageTolerance: new Percent(5, 100),
 *   deadlineOrPreviousBlockhash: Math.floor(Date.now() / 1000 + 1800),
 *   inputTokenPermit: permitData,
 * };
 * 
 * // 5. 调用router.route()方法进行交易
 * const route = await router.route(
 *   amountIn,
 *   tokenOut,
 *   TradeType.EXACT_INPUT,
 *   swapOptions,
 *   routingConfig
 * );
 */