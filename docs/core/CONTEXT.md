# Context Management System

## Overview

The Context Management System maintains conversation state, handles reference resolution, and manages memory for the AI agent.

## Core Features

### 1. Conversation Tracking
- Message history storage
- Role-based context (user/assistant)
- Timestamp tracking
- Context summarization

### 2. Reference Management
```typescript
interface Reference {
  type: 'token' | 'product' | 'order';
  identifier: string;
  context: any;
  timestamp: Date;
}
```

### 3. Memory Management
- Short-term memory (current session)
- Long-term memory (persistent storage)
- Context pruning
- Memory optimization

## Implementation

### Context Storage
```typescript
class ContextManager {
  async updateContext(userId, message, response) {
    const context = await this.getContext(userId);
    context.push({ role: 'user', content: message });
    context.push({ role: 'assistant', content: response });
    await this.persistContext(userId, context);
  }
}
```

### Reference Resolution
```typescript
async resolveReference(userId, reference) {
  const references = await this.getReferences(userId);
  return references.find(ref => 
    ref.type === reference.type && 
    ref.identifier === reference.identifier
  );
}
```

## Features

### 1. Context Awareness
- Previous message tracking
- Intent persistence
- State management
- Flow continuation

### 2. Reference Tracking
- Product references
- Token references
- Order references
- Transaction references

### 3. Memory Optimization
- Context pruning
- Relevance scoring
- Age-based cleanup
- Size limitations

## Usage Examples

### Context Update
```typescript
await contextManager.updateContext(userId, {
  message: "Buy some BONK",
  response: "How much BONK would you like to buy?",
  references: [{
    type: 'token',
    identifier: 'BONK',
    context: { network: 'solana' }
  }]
});
```

### Reference Resolution
```typescript
const ref = await contextManager.resolveReference(userId, {
  type: 'token',
  identifier: 'BONK'
});
```

## Best Practices

1. **Context Management**
   - Regular pruning
   - Size monitoring
   - Relevance checking
   - Performance optimization

2. **Reference Handling**
   - Unique identifiers
   - Type validation
   - Context preservation
   - Cleanup strategy

3. **Memory Optimization**
   - Cache utilization
   - Batch processing
   - Async operations
   - Resource monitoring