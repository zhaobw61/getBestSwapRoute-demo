import { BigNumber } from '@ethersproject/bignumber';
import { Protocol } from '@uniswap/router-sdk';
import { ChainId, CurrencyAmount, Token, TradeType } from '@uniswap/sdk-core';
import { AlphaRouterConfig, RouteWithValidQuote } from '../src/index';
import { PortionProvider } from '../src/providers/portion-provider';
import { getBestSwapRoute } from '../src/routers/alpha-router/functions/best-swap-route';

// Create tokens
const USDC = new Token(
  ChainId.MAINNET,
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  6,
  'USDC',
  'USD//C'
);

const WETH = new Token(
  ChainId.MAINNET,
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  18,
  'WETH',
  'Wrapped Ether'
);

// Create input amount
const amount = CurrencyAmount.fromRawAmount(USDC, '1000000'); // 1 USDC
const percents = [25, 50, 75, 100];

// Create mock routing config
const mockRoutingConfig: AlphaRouterConfig = {
  v4PoolSelection: {
    topN: 0,
    topNDirectSwaps: 0,
    topNTokenInOut: 0,
    topNSecondHop: 0,
    topNWithEachBaseToken: 0,
    topNWithBaseToken: 0,
  },
  v3PoolSelection: {
    topN: 0,
    topNDirectSwaps: 0,
    topNTokenInOut: 0,
    topNSecondHop: 0,
    topNWithEachBaseToken: 0,
    topNWithBaseToken: 0,
  },
  v2PoolSelection: {
    topN: 0,
    topNDirectSwaps: 0,
    topNTokenInOut: 0,
    topNSecondHop: 0,
    topNWithEachBaseToken: 0,
    topNWithBaseToken: 0,
  },
  maxSwapsPerPath: 3,
  minSplits: 1,
  maxSplits: 4,
  distributionPercent: 5,
  forceCrossProtocol: false,
};

// Create portion provider
const portionProvider = new PortionProvider();

// Create mock route with valid quote
const mockRoute: RouteWithValidQuote = {
  protocol: Protocol.V3,
  amount: CurrencyAmount.fromRawAmount(USDC, '1000000'),
  rawQuote: BigNumber.from('1000000000000000000'), // 1 WETH
  sqrtPriceX96AfterList: [BigNumber.from('0x01')],
  initializedTicksCrossedList: [1],
  quoterGasEstimate: BigNumber.from('100000'),
  quote: CurrencyAmount.fromRawAmount(WETH, '1000000000000000000'),
  percent: 100,
  route: {
    pools: [],
    tokenPath: [USDC, WETH],
    input: USDC,
    output: WETH,
    protocol: Protocol.V3,
    _midPrice: null,
    chainId: ChainId.MAINNET,
    midPrice: null,
  },
  gasModel: {
    estimateGasCost: () => ({
      gasEstimate: BigNumber.from('100000'),
      gasCostInToken: CurrencyAmount.fromRawAmount(USDC, '1000'),
      gasCostInUSD: CurrencyAmount.fromRawAmount(USDC, '1000'),
    }),
  },
  quoteToken: USDC,
  tradeType: TradeType.EXACT_INPUT,
  gasCostInToken: CurrencyAmount.fromRawAmount(USDC, '1000'),
  gasCostInUSD: CurrencyAmount.fromRawAmount(USDC, '1000'),
  gasEstimate: BigNumber.from('100000'),
  quoteAdjustedForGas: CurrencyAmount.fromRawAmount(WETH, '999000000000000000'),
  poolIdentifiers: ['0x123'],
  tokenPath: [USDC, WETH],
  greaterThan: function (other: RouteWithValidQuote) {
    return BigNumber.from(this.quoteAdjustedForGas.quotient).gt(
      BigNumber.from(other.quoteAdjustedForGas.quotient)
    );
  },
} as unknown as RouteWithValidQuote;

// Get best swap route
const swapRouteType = getBestSwapRoute(
  amount,
  percents,
  [mockRoute],
  TradeType.EXACT_INPUT,
  ChainId.MAINNET,
  { ...mockRoutingConfig, distributionPercent: 25 },
  portionProvider
);

console.log('Best Swap Route:', swapRouteType);
