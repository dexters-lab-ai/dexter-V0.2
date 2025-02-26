# Message Processing & Intent Flow Documentation

## Overview

This document details how KATZ processes messages from natural language to executed trades, including intent detection, parameter extraction, and execution flow.

## Message Processing Pipeline

### 1. Initial Message Reception
```typescript
// UnifiedMessageProcessor.processMessage()
async processMessage(msg, userId) {
  // Get conversation context
  const context = await contextManager.getContext(userId);
  
  // Analyze message intent
  const analysis = await intentAnalyzer.analyzeIntent(msg.text, context);
  
  // Process based on analysis type
  return analysis.type === 'compound' 
    ? await this.handleCompoundMessage(analysis, msg, userId)
    : await this.handleSingleMessage(analysis, msg, userId);
}
```

### 2. Intent Analysis
The IntentAnalyzer determines message intent and extracts parameters:

```typescript
// Example: "Buy 1 SOL of BONK and sell 50% at 2x"
{
  type: 'compound',
  intents: [
    {
      type: 'TOKEN_TRADE',
      parameters: {
        action: 'buy',
        amount: '1',
        token: 'BONK',
        unit: 'SOL'
      },
      priority: 1
    },
    {
      type: 'MULTI_TARGET_ORDER',
      parameters: {
        action: 'sell',
        targets: [
          { percentage: 50, multiplier: 2 }
        ]
      },
      priority: 2,
      dependsOn: ['TOKEN_TRADE']
    }
  ]
}
```

### 3. Parameter Validation
Each intent's parameters are validated against required fields:

```typescript
async validateParameters(intent, parameters) {
  const config = this.intentParameters.get(intent);
  if (!config) return true;

  const missing = config.required.filter(param => !parameters[param]);
  if (missing.length > 0) {
    throw new Error(`Missing required parameters: ${missing.join(', ')}`);
  }
  return true;
}
```

## Example Scenarios

### Scenario 1: Simple Trade
User: "Buy 1 SOL of BONK"

```typescript
// 1. Intent Analysis Result
{
  type: 'single',
  intent: 'TOKEN_TRADE',
  parameters: {
    action: 'buy',
    amount: '1',
    token: 'BONK',
    unit: 'SOL'
  }
}

// 2. User Messages
"🔍 Analyzing token BONK..."
"💰 Preparing trade..."
"✅ Trade executed successfully!"
```

### Scenario 2: Multi-Target Order
User: "Buy CHILLGUY and sell 50% at 2x, 25% at 3x, rest at 5x"

```typescript
// 1. Intent Analysis
{
  type: 'compound',
  intents: [
    {
      type: 'TOKEN_TRADE',
      parameters: {
        action: 'buy',
        token: 'CHILLGUY'
      }
    },
    {
      type: 'MULTI_TARGET_ORDER',
      parameters: {
        targets: [
          { percentage: 50, multiplier: 2 },
          { percentage: 25, multiplier: 3 },
          { percentage: 25, multiplier: 5 }
        ]
      },
      dependsOn: ['TOKEN_TRADE']
    }
  ]
}

// 2. User Messages
"🔍 Analyzing CHILLGUY..."
"💰 Preparing trade..."
"✅ Buy order executed!"
"⚡ Setting up take-profit orders..."
"✅ Take-profit orders placed successfully!"
```

### Scenario 3: KOL Monitoring
User: "Monitor @ChillGuyKOL and copy his trades with 0.5 SOL"

```typescript
// 1. Intent Analysis
{
  type: 'compound',
  intents: [
    {
      type: 'KOL_MONITOR_SETUP',
      parameters: {
        handle: 'ChillGuyKOL',
        amount: 0.5,
        unit: 'SOL'
      }
    }
  ]
}

// 2. User Messages
"🔍 Analyzing @ChillGuyKOL's trading history..."
"📊 Calculating optimal copy settings..."
"✅ KOL monitoring activated!"
```

## Error Handling & Fallbacks

### DexTools API Failure
```typescript
try {
  const price = await dextools.getTokenPrice(network, tokenAddress);
} catch (error) {
  // Fallback to DexScreener
  const price = await dexscreener.getTokenPrice(network, tokenAddress);
  
  // Notify user
  "⚠️ Using backup price source..."
}
```

### Progress Tracking
```typescript
async updateProgress(userId, status) {
  this.emit('progress', {
    userId,
    type: status.type,
    message: status.message,
    timestamp: Date.now()
  });
}
```

## Learning & Optimization

### User Adaptation
```typescript
// Update user preferences
await userLearningSystem.updateUserPreferences(userId, {
  riskTolerance: 0.7,
  preferredTokens: ['CHILLGUY', 'BONK'],
  tradingStyle: 'momentum'
});
```

## Best Practices

1. **Validation First**
   - Always validate parameters before execution
   - Check dependencies for compound intents
   - Verify user permissions and limits

2. **Progress Updates**
   - Keep user informed of each step
   - Show meaningful progress indicators
   - Handle errors gracefully with clear messages

3. **Resource Management**
   - Use connection pooling
   - Implement rate limiting
   - Cache frequently accessed data

4. **Error Recovery**
   - Implement fallback mechanisms
   - Provide clear error messages
   - Maintain system stability

5. **Performance Optimization**
   - Batch similar operations
   - Use parallel processing where safe
   - Optimize database queries