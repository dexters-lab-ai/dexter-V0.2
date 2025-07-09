# AI Core Services

## Overview

The AI Core is the central intelligence system of KATZ, handling natural language processing, intent detection, and coordinating complex multi-step operations.

## Key Components

### 1. UnifiedMessageProcessor
- Natural language understanding
- Intent classification
- Parameter extraction
- Context integration
- Multi-step flow routing

### 2. Intent System
```typescript
export const TRADING_INTENTS = {
  QUICK_TRADE: 'quick_trade',
  PRICE_ALERT: 'price_alert',
  MARKET_ANALYSIS: 'market_analysis',
  // ... more intents
}
```

### 3. Flow Management
- Multi-step operation handling
- State persistence
- Error recovery
- Progress tracking

## Features

### Intent Detection
- Pattern matching
- Context-aware classification
- Confidence scoring
- Parameter validation

### Context Management
- Chat history tracking
- Reference resolution
- Memory management
- Context pruning

### Flow System
- State machine implementation
- Progress tracking
- Error handling
- Rollback capabilities

## Usage Examples

### Basic Command Processing
```typescript
const result = await processor.processMessage({
  text: "Buy 1 SOL of BONK",
  userId: "123",
  context: []
});
```

### Multi-Step Operations
```typescript
const flow = await flowManager.startFlow(userId, 'trade', {
  token: 'BONK',
  amount: '1',
  targets: [
    { percentage: 50, multiplier: 2 },
    { percentage: 50, multiplier: 3 }
  ]
});
```

## Integration Points

### OpenAI Integration
- GPT model integration
- Prompt management
- Response formatting
- Error handling

### External Services
- DexTools API
- Twitter API
- Shopify Integration
- Solana Pay

## Error Handling

- Circuit breaker pattern
- Automatic retries
- Graceful degradation
- Error recovery flows

## Rate Limiting

- Per-user limits
- Token bucket algorithm
- Adaptive rate limiting
- Burst handling

## Monitoring

- Performance metrics
- Error tracking
- Usage statistics
- Health checks