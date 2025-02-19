import { createStorefrontApiClient } from '@shopify/storefront-api-client';
import { encodeURL, createQR } from '@solana/pay';
import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { ErrorHandler } from '../../core/errors/index.js';
import { cleanupManager } from '../../core/cleanup.js';


// Payment status enum
export const PaymentStatus = {
  INITIALIZED: 'initialized',
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

class ShopifyService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.wsClients = new Map();
    this.paymentSessions = new Map();
    this.initialized = false;
    this.solanaConnection = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize Storefront API client
      this.client = createStorefrontApiClient({
        storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
        apiVersion: '2025-01',
        publicAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN
      });

      // Initialize Solana connection
      this.solanaConnection = new Connection(process.env.SOLANA_RPC_URL);

      // Setup WebSocket server for real-time updates
      this.setupWebSocket();

      this.initialized = true;
      console.log('✅ Shopify service initialized');
    } catch (error) {
      console.error('❌ Error initializing Shopify service:', error);
      throw error;
    }
  }

  async setupWebSocket() {
    const wss = new WebSocket.Server({ port: process.env.WS_PORT || 8080 });

    wss.on('connection', (ws, req) => {
      const sessionId = this.extractSessionId(req.url);
      if (sessionId) {
        this.wsClients.set(sessionId, ws);
        
        ws.on('close', () => {
          this.wsClients.delete(sessionId);
        });
      }
    });
  }
  

  async searchProducts(query) {
    if (!this.initialized) {
      throw new Error('ShopifyService not initialized');
    }

    console.log('🔍 Searching products with query:', query);

    if (!query) {
      console.warn('⚠️ Empty search query provided');
      return [];
    }

    try {
      const searchQuery = `
        query SearchProducts($query: String!) {
          products(first: 5, query: $query) {
            edges {
              node {
                id
                title
                description
                handle
                priceRange {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                images(first: 1) {
                  edges {
                    node {
                      url
                      altText
                    }
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      availableForSale
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response = await this.client.request(searchQuery, {
        variables: { query }
      });

      if (!response?.data?.products?.edges) {
        console.warn('⚠️ No products found in response');
        return [];
      }

      const products = response.data.products.edges
        .map(({ node }) => this.formatProduct(node))
        .filter(Boolean);

      console.log('✅ Found products:', products);
      return products;
    } catch (error) {
      console.error('❌ Product search error:', error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async getProductById(productId) {
    if (!this.initialized) {
      throw new Error('ShopifyService not initialized');
    }

    console.log('🔍 Fetching product by ID:', productId);

    try {
      const query = `
        query GetProduct($id: ID!) {
          product(id: $id) {
            id
            title
            description
            handle
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            images(first: 1) {
              edges {
                node {
                  url
                  altText
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  availableForSale
                }
              }
            }
          }
        }
      `;

      const response = await this.client.request(query, {
        variables: { id: productId }
      });

      if (!response?.data?.product) {
        console.warn('⚠️ Product not found:', productId);
        return null;
      }

      const product = this.formatProduct(response.data.product);
      console.log('✅ Fetched product:', product);
      return product;
    } catch (error) {
      console.error('❌ Error fetching product:', error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // Helper method to format a single product
  formatProduct(node) {
    if (!node) {
      console.warn('⚠️ Missing product data');
      return null;
    }

    try {
      return {
        id: node.id,
        title: node.title,
        description: node.description,
        price: node.priceRange?.minVariantPrice?.amount,
        currency: node.priceRange?.minVariantPrice?.currencyCode,
        image: node.images?.edges[0]?.node?.url,
        variantId: node.variants?.edges[0]?.node?.id,
        available: node.variants?.edges[0]?.node?.availableForSale,
        url: `https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${node.handle}`
      };
    } catch (error) {
      console.error('❌ Error formatting product:', error);
      return null;
    }
  }
  
  formatProducts(edges) {
    if (!Array.isArray(edges)) {
      console.error('❌ Invalid products data:', edges);
      throw new Error('Products must be an array');
    }
  
    return edges.map(({ node }) => {
      if (!node) {
        console.warn('⚠️ Missing node in product edge');
        return null;
      }
  
      try {
        return {
          id: node.id,
          title: node.title,
          description: node.description,
          price: node.priceRange?.minVariantPrice?.amount,
          currency: node.priceRange?.minVariantPrice?.currencyCode,
          image: node.images?.edges[0]?.node?.url,
          variantId: node.variants?.edges[0]?.node?.id,
          available: node.variants?.edges[0]?.node?.availableForSale
        };
      } catch (error) {
        console.error('❌ Error formatting product:', {
          error: error.message,
          node
        });
        return null;
      }
    }).filter(Boolean); // Remove any null products
  }

  async createCheckout(productId, quantity = 1) {
    try {
      const { data } = await this.client.request(`
        mutation createCheckout($input: CheckoutCreateInput!) {
          checkoutCreate(input: $input) {
            checkout {
              id
              webUrl
              totalPrice {
                amount
                currencyCode
              }
            }
            checkoutUserErrors {
              code
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            lineItems: [{ variantId: productId, quantity }]
          }
        }
      });

      if (data.checkoutCreate.checkoutUserErrors.length > 0) {
        throw new Error(data.checkoutCreate.checkoutUserErrors[0].message);
      }

      const sessionId = this.createPaymentSession(data.checkoutCreate.checkout);
      return {
        checkoutId: data.checkoutCreate.checkout.id,
        sessionId,
        totalAmount: data.checkoutCreate.checkout.totalPrice.amount
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async createSolanaPayment(sessionId, amount) {
    try {
      const session = this.paymentSessions.get(sessionId);
      if (!session) {
        throw new Error('Invalid payment session');
      }

      const recipient = new PublicKey(process.env.MERCHANT_WALLET);
      const reference = new PublicKey(sessionId);
      const label = 'KATZ Store Payment';
      const message = 'Thanks for shopping with KATZ!';

      // Create Solana Pay URL
      const url = encodeURL({
        recipient,
        amount,
        reference,
        label,
        message
      });

      // Generate QR code
      const qrCode = await createQR(url);

      // Update session with payment details
      session.paymentUrl = url;
      session.qrCode = qrCode;
      session.status = PaymentStatus.PENDING;
      
      this.paymentSessions.set(sessionId, session);

      // Start monitoring for payment
      this.monitorPayment(sessionId, reference);

      return {
        sessionId,
        paymentUrl: url.toString(),
        qrCode
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async monitorPayment(sessionId, reference) {
    try {
      // Monitor for transaction containing our reference
      const signature = await this.findTransactionSignature(reference);
      if (!signature) return;

      // Verify the transaction
      const valid = await this.validateTransaction(signature, reference);
      if (!valid) {
        throw new Error('Invalid transaction');
      }

      // Update session status
      await this.updatePaymentStatus(sessionId, PaymentStatus.COMPLETED);

      // Notify client via WebSocket
      this.notifyClient(sessionId, {
        type: 'payment_complete',
        signature
      });

    } catch (error) {
      await ErrorHandler.handle(error);
      await this.updatePaymentStatus(sessionId, PaymentStatus.FAILED);
    }
  }

  async findTransactionSignature(reference) {
    const signatures = await this.solanaConnection.getSignaturesForAddress(
      new PublicKey(reference),
      { limit: 1 }
    );
    return signatures[0]?.signature;
  }

  async validateTransaction(signature, reference) {
    const tx = await this.solanaConnection.getTransaction(signature);
    // Add validation logic here
    return true;
  }

  async updatePaymentStatus(sessionId, status) {
    const session = this.paymentSessions.get(sessionId);
    if (session) {
      session.status = status;
      this.paymentSessions.set(sessionId, session);
      this.emit('statusUpdate', { sessionId, status });
    }
  }

  notifyClient(sessionId, data) {
    const ws = this.wsClients.get(sessionId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  createPaymentSession(checkout) {
    const sessionId = this.generateSessionId();
    this.paymentSessions.set(sessionId, {
      checkoutId: checkout.id,
      status: PaymentStatus.INITIALIZED,
      createdAt: new Date(),
      totalAmount: checkout.totalPrice.amount
    });
    return sessionId;
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  extractSessionId(url) {
    const match = url.match(/session=([^&]*)/);
    return match ? match[1] : null;
  }

  cleanup() {
    // Close all WebSocket connections
    for (const ws of this.wsClients.values()) {
      ws.close();
    }
    this.wsClients.clear();
    
    // Clear payment sessions
    this.paymentSessions.clear();
    
    // Remove all listeners
    this.removeAllListeners();
    
    this.initialized = false;
    console.log('✅ Shopify service cleaned up');
  }
}

export const shopifyService = new ShopifyService();

// Initialize service
shopifyService.initialize().catch(console.error);

// Handle cleanup on process termination
// Removed the process.on handlers and register with cleanup manager
cleanupManager.registerService('shopify', () => shopifyService.cleanup());