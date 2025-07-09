#  Documentation

> **D.A.I.L - Dexter's AI Lab**  
> *Transforming Crypto Intelligence with AI-Powered Data*

---

## Table of Contents

- [Overview](#overview)
- [Value Proposition](#value-proposition)
- [Authentication & API Keys](#authentication--api-keys)
- [API Endpoints](#api-endpoints)
  - [Public Endpoints](#public-endpoints)
  - [Protected Endpoints](#protected-endpoints)
- [Internal Monitoring Endpoints](#internal-monitoring-endpoints)
- [Usage Examples](#usage-examples)
- [Frequently Asked Questions (FAQ)](#frequently-asked-questions-faq)
- [Future Roadmap](#future-roadmap)
- [Contact & Support](#contact--support)

---

## Overview

Welcome to the **D.A.I.L API** – the cornerstone of our AI-driven crypto intelligence platform. Our API empowers developers, traders, and data scientists with real‑time, actionable data derived from advanced AI processing. Whether you’re building high‑performance trading systems or innovative market analytics applications, the D.A.I.L API delivers deep insights into market sentiment and token analytics that give you a competitive edge.

---

## Value Proposition

With the D.A.I.L API you gain access to:
- **Real‑Time Sentiment Analysis:**  
  Harness AI to accurately gauge market sentiment and social signals, helping you anticipate market shifts.
- **Comprehensive Token Analytics:**  
  Retrieve in‑depth token performance data including on‑chain metrics, price trends, and security insights.
- **Reliable & Scalable Data:**  
  Our API infrastructure is built for speed and reliability, ensuring your applications receive high‑quality data with minimal latency.
- **Seamless Integration:**  
  Enjoy a modern RESTful API with WebSocket real‑time updates and simple, intuitive endpoints that integrate effortlessly into your systems.

*Our API is designed for external use, while internal monitoring endpoints (detailed below) help us continuously optimize our agent’s performance.*

---

## Authentication & API Keys

### Generating an API Key

Protected endpoints require an API key. To generate an API key, sign up through our official process (pricing and full sign‑up instructions are available on our website) and then send a request as follows:

**Endpoint:** `POST /api/keys`  
**Request Body Example:**
```json
{
  "tier": "basic"
}
```
**Response Example:**
```json
{
  "success": true,
  "key": "dail_123e4567-e89b-12d3-a456-426614174000"
}
```

Once you have an API key, include it in the header for all protected endpoints:
```
X-API-Key: <your-api-key>
```

---

## API Endpoints

### Public Endpoints

These endpoints are accessible without authentication.

#### GET /api/ping
Checks connectivity and latency.
**Response:**
```json
{
  "message": "pong",
  "timestamp": "2025-03-06T12:00:00.000Z"
}
```

#### GET /api/version
Returns the current API version and build details.
**Response:**
```json
{
  "version": "1.0.0",
  "environment": "production",
  "build": "20250306-001"
}
```

#### GET /api/status
Provides real‑time health status of our public services.
**Response:**
```json
{
  "services": {
    "sentiment": { "status": "healthy" },
    "token": { "status": "healthy" },
    "database": { "status": "healthy" }
  },
  "system": {
    "uptime": "1234.56",
    "timestamp": "2025-03-06T12:00:00.000Z"
  }
}
```

### Protected Endpoints

These endpoints require a valid API key (via the `X-API-Key` header).

#### POST /api/v1/sentiment
Analyzes market sentiment for a given token or project.
**Headers Required:**  
```
X-API-Key: <your-api-key>
```
**Request Body Example:**
```json
{
  "query": "BONK",
  "network": "solana"
}
```
**Expected Response:**
```json
{
  "sentiment": {
    "score": 75,
    "confidence": 0.92,
    "direction": "bullish"
  },
  "metrics": {
    "mentions": 102,
    "engagement": 560,
    "uniqueUsers": 89
  },
  "timestamp": "2025-03-06T12:00:00.000Z"
}
```

#### POST /api/v1/token
Fetches comprehensive token analytics including on‑chain data, price, market data, and security insights.
**Headers Required:**  
```
X-API-Key: <your-api-key>
```
**Request Body Example:**
```json
{
  "token": "0xABC123...",
  "network": "ethereum"
}
```
**Expected Response:**
```json
{
  "token": {
    "address": "0xABC123...",
    "name": "ExampleToken",
    "symbol": "EXT",
    "decimals": 18
  },
  "price": {
    "current": 0.25,
    "change24h": -0.05,
    "high24h": 0.30,
    "low24h": 0.20
  },
  "market": {
    "mcap": 5000000,
    "volume24h": 250000,
    "liquidity": 750000
  },
  "security": {
    "score": 85,
    "issues": [],
    "audit": {}
  },
  "social": {
    "sentiment": 80,
    "mentions24h": 150,
    "trending": true
  },
  "timestamp": "2025-03-06T12:00:00.000Z"
}
```

---

## Internal Monitoring Endpoints

These endpoints are for internal use only. They help our systems track the performance of our AI agents and ensure optimal service delivery since the external TokenScrub and SentimentScrub APIs are served from our AI Agent directly. They are not exposed publicly for external integration.

#### GET /api/status/internal
Provides detailed internal health metrics, including service statuses, system performance, and error logs.
**Response Example:**
```json
{
  "services": {
    "sentiment": { "status": "healthy" },
    "token": { "status": "healthy" },
    "database": { "status": "healthy" }
  },
  "system": {
    "uptime": "1234.56",
    "timestamp": "2025-03-06T12:00:00.000Z"
  },
  "metrics": {
    "openai": { "totalTokens": 1000000, "totalCost": 150.50 },
    "functions": { "totalCalls": 5000, "successRate": "95%" }
  }
}
```

*Note: This endpoint is used internally to continuously monitor the health of our services and optimize our AI agents. It is not intended for public use.*

---

## Usage Examples

### Example: Sentiment Analysis with Curl
```bash
curl -X POST https://your-domain.com/api/v1/sentiment \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dail_123e4567-e89b-12d3-a456-426614174000" \
  -d '{
        "query": "BTC",
        "network": "ethereum"
      }'
```

### Example: Token Analytics with Curl
```bash
curl -X POST https://your-domain.com/api/v1/token \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dail_123e4567-e89b-12d3-a456-426614174000" \
  -d '{
        "token": "0xABC123...",
        "network": "ethereum"
      }'
```

---

## Frequently Asked Questions (FAQ)

**Q: Which endpoints require authentication?**  
A: Protected endpoints—such as `/api/v1/sentiment` and `/api/v1/token`—require an API key included in the `X-API-Key` header. Public endpoints (e.g. `/api/ping`, `/api/version`, `/api/status`) are accessible without authentication.

**Q: How do I generate an API key?**  
A: An API key is generated during the sign‑up process. Once you have signed up, request your API key using the `POST /api/keys` endpoint. (Full pricing details and the sign‑up process are available on our website.)

**Q: What do I do if my API key exceeds usage limits?**  
A: If your API key exceeds your allowed quota or rate limits, subsequent requests will be rejected. Please refer to your pricing plan for the specific limits.

**Q: What is the purpose of the internal monitoring endpoints?**  
A: These endpoints provide insights into the health and performance of our internal systems, ensuring that our AI agents and backend services operate optimally. They are not intended for public consumption.

---

## Future Roadmap

- **Enhanced Analytics:**  
  More granular usage metrics and performance dashboards.
- **Additional Endpoints:**  
  New features for advanced market analytics and custom alerts.
- **Improved Security:**  
  Integration of OAuth2 for secure, granular access control.
- **Broader Ecosystem Integration:**  
  Expanded integrations with third-party services and platforms.

---

## Contact & Support

For further assistance or inquiries, please reach out:

- **Documentation:** [https://docs.dexter-ai.io](https://docs.dexter-ai.io)
- **Support Email:** support@dexter-ai.io
- **Twitter:** [@dexters_ai_lab](https://twitter.com/dexters_ai_lab)
- **Telegram:** [@the_ai_lab_announcements](https://t.me/the_ai_lab_announcements)

---

*Experience the future of crypto intelligence with D.A.I.L – where cutting‑edge AI meets actionable market insights.*
