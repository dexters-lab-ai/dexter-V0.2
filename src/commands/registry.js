import { bot } from '../core/bot.js';
import { EventEmitter } from 'events';
import { ErrorHandler } from '../core/errors/index.js';
import { SettingsCommand } from '../commands/settings/SettingsCommand.js';
import { StartCommand } from './start/StartCommand.js';
import { ScanCommand } from './scan/ScanCommand.js';
import { HelpCommand } from '../commands/help/HelpCommand.js';
import { eventHandler } from '../events/EventHandler.js'; 

export class CommandRegistry extends EventEmitter {
  constructor(bot) {
    super();
    this.bot = bot;
    this.commands = new Map();
    this.callbackHandlers = new Map();
    // Instantiate common commands so that their callbacks can be referenced
    this.startCommand = new StartCommand(bot, eventHandler);
    this.scanCommand = new ScanCommand(bot);
    this.settingsCommand = new SettingsCommand(bot);
    this.helpCommand = new HelpCommand(bot);
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      this.registerGlobalCallbacks();
      console.log('✅ CommandRegistry initialized with', this.commands.size, 'commands');
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('❌ Error initializing CommandRegistry:', error);
      throw error;
    }
  }

  registerCommand(command) {
    if (!command.command || !command.description) {
      throw new Error('Invalid command format: missing .command or .description');
    }
    this.commands.set(command.command, command);
    if (typeof command.getCallbackHandlers === 'function') {
      const handlers = command.getCallbackHandlers();
      // Use Object.entries to iterate over object properties
      Object.entries(handlers).forEach(([action, handler]) => {
        this.callbackHandlers.set(action, handler.bind(command));
      });
    }
    console.log(`✅ Registered command: ${command.command}`);
  }

  registerGlobalCallbacks() {
    const globalCallbacks = ['back_to_menu', 'switch_network', 'retry_action', 'back_to_wallets'];
    globalCallbacks.forEach(action => {
      if (!this.callbackHandlers.has(action)) {
        this.callbackHandlers.set(action, async (query) => {
          console.log(`⚠️ Unhandled global callback: ${action}`);
          return false;
        });
      }
    });
  }

  findCommandForCallback(action) {
    for (const command of this.commands.values()) {
      if (command.canHandleCallback && command.canHandleCallback(action)) {
        return command;
      }
    }
    return null;
  }

  async handleCallback(query) {
    try {
      if (!query || !query.data) return false;
      const action = query.data;
      console.log('🔄 Processing callback:', action);

      // Check for a global callback handler first
      const globalHandler = this.callbackHandlers.get(action);
      if (globalHandler && await globalHandler(query)) return true;

      // Route settings-related actions
      const settingsActions = [
        "llm_settings", "switch_llm_openai", "switch_llm_deepseek",
        "autonomous_settings", "toggle_autonomous",
        "notification_settings", "toggle_notifications",
        "slippage_settings", "adjust_eth_slippage",
        "adjust_base_slippage", "adjust_sol_slippage",
        "switch_network", "back_to_settings", "back_to_wallets"
      ];
      if (settingsActions.includes(action)) {
        await this.settingsCommand.handleCallbackQuery(query);
        return true;
      }

      // Route scan related actions
      if (["scan_input", "retry_scan", "retry_action"].includes(action)) {
        const scanCommand = this.commands.get('/scan');
        if (scanCommand) {
          await scanCommand.handleCallbackQuery(query);
          return true;
        }
      }

      // Route help-related actions
      const helpActions = [
        "help_trading", "help_wallets", "help_automation",
        "help_encryption", "help_architecture", "help_scenarios",
        "back_to_help"
      ];
      if (helpActions.includes(action)) {
        await this.helpCommand.handleCallbackQuery(query);
        return true;
      }

      console.warn('⚠️ No handler found for callback:', action);
      return false;
    } catch (error) {
      console.error('❌ Error in callback handler:', error);
      await ErrorHandler.handle(error, this.bot, query.message?.chat?.id);
      return false;
    }
  }

  findCommand(text) {
    const exactCmd = this.commands.get(text.split(' ')[0]);
    if (exactCmd) return exactCmd;
    for (const cmd of this.commands.values()) {
      if (cmd.pattern?.test(text)) return cmd;
    }
    return null;
  }

  getCommands() {
    return Array.from(this.commands.values());
  }

  cleanup() {
    this.commands.clear();
    this.callbackHandlers.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const commandRegistry = new CommandRegistry(bot);