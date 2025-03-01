import mongoose from "mongoose";
import { NETWORKS } from "../core/constants.js";
import { encrypt, decrypt } from "../utils/encryption.js";

// Define ResearchSchema before using it in UserSchema
const ResearchSchema = new mongoose.Schema({
  researchId: { type: String, required: true },
  content: { type: String, required: true },
  keywords: { type: [String], required: true },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const EmailThreadSchema = new mongoose.Schema({
  threadId: { type: String, required: true },
  snippet: String,        // short snippet from the email
  historyId: String,      // used for subsequent sync
  subject: String,
  lastUpdated: { type: Date, default: Date.now }
});

// Wallet Schema Definition
const WalletSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    index: true
  },
  encryptedPrivateKey: {
    type: String,
    required: true
  },
  encryptedMnemonic: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ["internal", "walletconnect"],
    default: "internal"
  },
  isAutonomous: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Sub-schema for bridging records
const BridgingRecordSchema = new mongoose.Schema({
  bridgingId: {
    type: String,
    required: true,
    index: true // So we can query by bridgingId if needed
  },
  sourceChain: { type: String, required: true },
  targetChain: { type: String, required: true },
  tokenSymbol: { type: String, required: true },
  amount: { type: String, required: true },
  routeUsed: { type: String }, // e.g. "AutomaticTokenBridgeRoute"
  txReceipt: { type: mongoose.Schema.Types.Mixed }, // store final receipt object
  status: {
    type: String,
    enum: ["PENDING", "COMPLETED", "FAILED"],
    default: "PENDING"
  },
  logs: [
    {
      type: String
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
});

// Monitor Sub-Schema
const MonitorSchema = new mongoose.Schema({
  handle: { type: String },       // e.g. "@SomeTwitterHandle"
  query:  { type: String },       // fallback or additional query string
  amount: { type: Number, default: 0 },
  startTime: { type: Date, default: Date.now },

  // New fields:
  enabled: { type: Boolean, default: false },
  lastChecked: { type: Date },          // last time we successfully checked
  lastTweetId: { type: String },        // if you prefer ID-based tracking
});

// Main User Schema
const UserSchema = new mongoose.Schema(
  {
    telegramId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    wallets: {
      sonic: [WalletSchema],      
      ethereum: [WalletSchema],
      base: [WalletSchema],
      solana: [WalletSchema],
      avalanche: [WalletSchema],
      bsc: [WalletSchema]
    },
    googleAuth: {
      encryptedAccessToken: { type: String, default: "" },
      encryptedRefreshToken: { type: String, default: "" },
      scope: { type: String, default: "" },
      tokenType: { type: String, default: "" },
      expiryDate: { type: Number },  // in ms since epoch
    },
    emailThreads: {
      type: [EmailThreadSchema],
      default: []
    },
    phoneNumbers: {
      type: [String],
      default: []
    },
    bridgingRecords: {
      type: [BridgingRecordSchema],
      default: []
    },
    researches: {
      type: [ResearchSchema],
      default: []
    },
    settings: {
      defaultLLM: {
        type: String,
        enum: ["openai", "deepseek"],
        default: "openai"
      },
      defaultNetwork: {
        type: String,
        enum: Object.values(NETWORKS),
        default: NETWORKS.ETHEREUM
      },
      notifications: {
        enabled: {
          type: Boolean,
          default: true
        },
        showInChat: {
          type: Boolean,
          default: true
        },
        gemsToday: {
          type: Boolean,
          default: true
        }
      },
      trading: {
        autonomousEnabled: {
          type: Boolean,
          default: true
        },
        slippage: {
          ethereum: { type: Number, default: 3, min: 0.1, max: 50 },
          base: { type: Number, default: 3, min: 0.1, max: 50 },
          solana: { type: Number, default: 3, min: 0.1, max: 50 },
          avalanche: { type: Number, default: 3, min: 0.1, max: 50 } 
        }
      },
      googleAuth: {
        accessToken: String,
        refreshToken: String,
        expiryDate: Date
      },
      kol: {
        enabled: { type: Boolean, default: false },
        monitors: [MonitorSchema]  // <-- uses the same sub-schema
      }
    },
    registeredAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    collection: "users"
  }
);

// Add indexes
UserSchema.index({ "wallets.ethereum.address": 1 });
UserSchema.index({ "wallets.base.address": 1 });
UserSchema.index({ "wallets.solana.address": 1 });
UserSchema.index({ "wallets.avalanche.address": 1 }); 
UserSchema.index({ "settings.autonomousWallet.address": 1 });

// Pre-save middleware
UserSchema.pre("save", function (next) {
  if (this.telegramId && typeof this.telegramId !== "string") {
    this.telegramId = this.telegramId.toString();
  }
  next();
});

// Instance Methods
UserSchema.methods = {
  setGoogleTokens: async function(tokens) {
    if (tokens.access_token) {
      this.googleAuth.encryptedAccessToken = encrypt(tokens.access_token);
    }
    if (tokens.refresh_token) {
      this.googleAuth.encryptedRefreshToken = encrypt(tokens.refresh_token);
    }
    if (tokens.scope) this.googleAuth.scope = tokens.scope;
    if (tokens.token_type) this.googleAuth.tokenType = tokens.token_type;
    if (tokens.expiry_date) this.googleAuth.expiryDate = tokens.expiry_date;
    await this.save();
  },

  getDecryptedGoogleTokens: function() {
    return {
      access_token: this.googleAuth.encryptedAccessToken
        ? decrypt(this.googleAuth.encryptedAccessToken)
        : "",
      refresh_token: this.googleAuth.encryptedRefreshToken
        ? decrypt(this.googleAuth.encryptedRefreshToken)
        : "",
      scope: this.googleAuth.scope,
      token_type: this.googleAuth.tokenType,
      expiry_date: this.googleAuth.expiryDate
    };
  },

  // Optionally, store an email thread reference
  addEmailThread: async function(threadId, snippet, subject, historyId) {
    // If we want to avoid duplicates, we can check:
    const existing = this.emailThreads.find(t => t.threadId === threadId);
    if (!existing) {
      this.emailThreads.push({ threadId, snippet, subject, historyId });
    } else {
      // update existing
      existing.snippet = snippet || existing.snippet;
      existing.subject = subject || existing.subject;
      existing.historyId = historyId || existing.historyId;
      existing.lastUpdated = new Date();
    }
    return this.save();
  },

  // Get active wallet with proper error handling and validation
  getActiveWallet: function(network) {
    if (!network || !Object.values(NETWORKS).includes(network)) {
      throw new Error(`Invalid network: ${network}`);
    }

    if (!this.wallets?.[network]?.length) {
      return null;
    }

    // Return first wallet for network with basic info
    const wallet = this.wallets[network][0];
    return {
      address: wallet.address,
      type: wallet.type,
      isAutonomous: wallet.isAutonomous,
      createdAt: wallet.createdAt
    };
  },

  // Get decrypted wallet with proper validation and error handling
  getDecryptedWallet: function(network, address) {
    if (!network || !address) {
      throw new Error('Network and address are required');
    }

    const wallet = this.wallets[network]?.find(w => w.address === address);
    if (!wallet) {
      return null;
    }

    try {
      return {
        address: wallet.address,
        privateKey: decrypt(wallet.encryptedPrivateKey),
        mnemonic: decrypt(wallet.encryptedMnemonic),
        network,
        type: wallet.type || 'internal',
        isAutonomous: wallet.isAutonomous,
        createdAt: wallet.createdAt
      };
    } catch (error) {
      console.error(`Error decrypting wallet ${address}:`, error);
      throw new Error('Failed to decrypt wallet data');
    }
  },

  // Set autonomous wallet with validation
  setAutonomousWallet: async function(network, address) {
    if (!network || !address) {
      throw new Error('Network and address are required');
    }

    const wallet = this.wallets[network]?.find(w => w.address === address);
    if (!wallet) {
      return false;
    }

    try {
      wallet.isAutonomous = true;
      await this.save();
      return true;
    } catch (error) {
      console.error(`Error setting autonomous wallet ${address}:`, error);
      throw new Error('Failed to update wallet');
    }
  },

  // Add new wallet with encryption and validation
  addWallet: async function(network, walletData) {
    if (!network || !walletData?.address || !walletData?.privateKey || !walletData?.mnemonic) {
      throw new Error('Invalid wallet data');
    }

    if (!this.wallets[network]) {
      this.wallets[network] = [];
    }

    try {
      const encryptedWallet = {
        address: walletData.address,
        encryptedPrivateKey: encrypt(walletData.privateKey),
        encryptedMnemonic: encrypt(walletData.mnemonic),
        type: walletData.type || 'internal',
        isAutonomous: false,
        createdAt: new Date()
      };

      this.wallets[network].push(encryptedWallet);
      await this.save();
      return true;
    } catch (error) {
      console.error(`Error adding wallet for ${network}:`, error);
      throw new Error('Failed to add wallet');
    }
  },

  // Remove wallet
  removeWallet: async function(network, address) {
    if (!this.wallets[network]) return false;

    const initialLength = this.wallets[network].length;
    this.wallets[network] = this.wallets[network].filter(w => w.address !== address);

    if (this.wallets[network].length < initialLength) {
      return await this.save();
    }
    return false;
  },

  // Update wallet settings
  updateWalletSettings: async function(settings) {
    if (settings.defaultNetwork) {
      this.settings.defaultNetwork = settings.defaultNetwork;
    }
    if (settings.slippage) {
      Object.assign(this.settings.trading.slippage, settings.slippage);
    }
    if (typeof settings.autonomousEnabled === 'boolean') {
      this.settings.trading.autonomousEnabled = settings.autonomousEnabled;
    }
    return await this.save();
  },

  // Saves a new bridging request to this user's record
  async addBridgingRecord(record) {
    // record should be an object matching BridgingRecordSchema fields
    this.bridgingRecords.push(record);
    await this.save();
    return record;
  },

  // updateBridgingRecord
  async updateBridgingRecord(bridgingId, updates) {
    const idx = this.bridgingRecords.findIndex(r => r.bridgingId === bridgingId);
    if (idx < 0) {
      throw new Error(`Bridging record '${bridgingId}' not found for user ${this.telegramId}`);
    }

    // Merge updates
    Object.assign(this.bridgingRecords[idx], updates);

    // If status is completed or failed, set completedAt
    if (updates.status && ["COMPLETED", "FAILED"].includes(updates.status)) {
      this.bridgingRecords[idx].completedAt = new Date();
    }

    await this.save();
    return this.bridgingRecords[idx];
  },

  // Appends a log line to bridgingRecord's logs array
  async addBridgingLog(bridgingId, logMessage) {
    const idx = this.bridgingRecords.findIndex(r => r.bridgingId === bridgingId);
    if (idx < 0) {
      throw new Error(`Bridging record '${bridgingId}' not found for user ${this.telegramId}`);
    }
    this.bridgingRecords[idx].logs.push(logMessage);
    await this.save();
  },

  // Return bridging records, optionally limit or filter
  getBridgingRecords(limit = 10) {
    // e.g. return last 10 bridging records
    return this.bridgingRecords
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  // Research methods
  addResearchRecord: async function (record) {
    this.researches.push(record);
    return this.save();
  },
  getResearchRecordById: function (researchId) {
    return this.researches.find(r => r.researchId === researchId);
  },
  getResearchRecordsByKeyword: function (keyword) {
    return this.researches.filter(r => r.keywords.includes(keyword));
  },
  deleteResearchRecordById: async function (researchId) {
    this.researches = this.researches.filter(r => r.researchId !== researchId);
    return this.save();
  }
};

// Static Methods
UserSchema.statics = {
  // Find user by telegram ID
  findByTelegramId: async function(telegramId) {
    return await this.findOne({ telegramId: telegramId.toString() }).exec();
  },

  // Get all users with autonomous trading enabled
  getAutonomousUsers: async function() {
    return await this.find({
      'settings.trading.autonomousEnabled': true
    }).exec();
  },

  // Get users by network
  getUsersByNetwork: async function(network) {
    return await this.find({
      [`wallets.${network}`]: { $exists: true, $ne: [] }
    }).exec();
  },

  // Shortcut to load user by telegramId & return bridgingRecords
  async fetchUserBridgingRecords(telegramId, limit = 10) {
    const user = await this.findOne({ telegramId }).exec();
    if (!user) {
      throw new Error(`User not found with telegramId: ${telegramId}`);
    }
    return user.getBridgingRecords(limit);
  },
};

// Create the model
const User = mongoose.model('User', UserSchema);

export { User };
