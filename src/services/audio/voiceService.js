// voiceService.js
import { ElevenLabsClient } from "elevenlabs";
import { SpeechClient } from "@google-cloud/speech";
import { config } from "../../core/config.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";
import textToSpeech from "@google-cloud/text-to-speech";
import { aiMetricsService } from "../../services/aiMetricsService.js";

const openai = new OpenAI();

export class VoiceService {
  constructor(bot) {
    this.bot = bot;
    this.elevenLabs = new ElevenLabsClient({
      apiKey: config.elevenLabsApiKey,
    });
    
    // Initialize Google clients safely with fallbacks for path resolution
    this.initGoogleClients();
    
    this.defaultModel = "eleven_multilingual_v2"; // Default model for ElevenLabs multilingual support
    this.defaultVoice = "N2lVS1w4EtoT3dr4eOWO"; // Default ElevenLabs voice
  }
  
  /**
   * Safely initialize Google API clients with path resolution and fallbacks
   */
  initGoogleClients() {
    try {
      // Get the key file path from config
      const keyFilePath = config.googleApiKeyFile;
      console.log(`🔑 Initializing Google clients with key file path: ${keyFilePath}`);
      
      // Check if file exists at the configured path
      let finalKeyPath = keyFilePath;
      
      // Helper to check if a file exists
      const fileExists = (path) => {
        try {
          return fs.existsSync(path);
        } catch (err) {
          return false;
        }
      };
      
      // Try different path variations to find the file
      if (!fileExists(finalKeyPath)) {
        console.log(`⚠️ Key file not found at: ${finalKeyPath}, trying alternatives...`);
        
        // Try absolute path if relative was provided
        if (!finalKeyPath.startsWith('/')) {
          const absolutePath = `/usr/src/app/${keyFilePath}`;
          if (fileExists(absolutePath)) {
            console.log(`✅ Found key file at absolute path: ${absolutePath}`);
            finalKeyPath = absolutePath;
          }
        }
        
        // Check backup location
        if (!fileExists(finalKeyPath)) {
          const backupPath = '/usr/src/app/katz-speech-to-text-key.json';
          if (fileExists(backupPath)) {
            console.log(`✅ Found key file at backup path: ${backupPath}`);
            finalKeyPath = backupPath;
          }
        }
        
        // Still not found - try to create it
        if (!fileExists(finalKeyPath)) {
          console.log(`⚠️ Key file not found anywhere, attempting to create it at: ${finalKeyPath}`);
          this.createGoogleTTSKeyFile(finalKeyPath);
        }
      }
      
      // Initialize clients with the resolved path
      console.log(`🔄 Initializing Google clients with resolved key path: ${finalKeyPath}`);
      
      try {
        this.speechClient = new SpeechClient({ keyFilename: finalKeyPath });
        console.log('✅ Speech client initialized successfully');
      } catch (error) {
        console.error('❌ Failed to initialize Speech client:', error.message);
        this.speechClient = null;
      }
      
      try {
        this.ttsClient = new textToSpeech.TextToSpeechClient({ keyFilename: finalKeyPath });
        console.log('✅ TTS client initialized successfully');
      } catch (error) {
        console.error('❌ Failed to initialize TTS client:', error.message);
        this.ttsClient = null;
      }
    } catch (error) {
      console.error('❌ Error initializing Google clients:', error.message);
      this.speechClient = null;
      this.ttsClient = null;
    }
  }

  // Exponential Backoff Retry Helper
  async retryWithBackoff(fn, retries = 7, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        console.warn(`⚠️ Attempt ${i + 1} failed: ${error.message}`);
        if (i < retries - 1) {
          await new Promise((res) => setTimeout(res, delay * Math.pow(2, i)));
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Transcribe voice message using Google Speech-to-Text (STT)
   * @param {string} voiceUrl - Telegram file URL for the voice message
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribeVoice(voiceUrl) {
    const start = Date.now();
    const transcription = await this.retryWithBackoff(async () => {
      try {
        const response = await axios.get(voiceUrl, { responseType: "arraybuffer" });
        const audioBuffer = Buffer.from(response.data);
        const request = {
          audio: { content: audioBuffer.toString("base64") },
          config: {
            encoding: "OGG_OPUS",
            sampleRateHertz: 16000,
            languageCode: "en-US",
          },
        };
        const [operation] = await this.speechClient.recognize(request);
        const transcript = operation.results
          .map((result) => result.alternatives[0].transcript)
          .join(" ");
        return transcript;
      } catch (error) {
        console.error("❌ Google STT Error:", error.message);
        throw new Error("Failed to transcribe voice message.");
      }
    });
    const duration = Date.now() - start;
    // Track STT usage for Google STT.
    aiMetricsService.trackSTTUsage("google-stt", duration);
    return transcription;
  }

  /**
   * Transcribe voice using OpenAI Whisper API (STT)
   * @param {string} fileUrl - Telegram voice message file URL
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribeVoiceWhisp(fileUrl) {
    const start = Date.now();
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, "voice_message.ogg");

    try {
      const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
      fs.writeFileSync(filePath, response.data);
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-1",
        prompt: "transcribe audio with high accuracy...",
      });
      return transcription.text.trim();
    } catch (error) {
      console.error("❌ Whisper transcription error:", error.message);
      throw new Error("Failed to transcribe the voice message.");
    } finally {
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted temp file: ${filePath}`);
      } catch (cleanupError) {
        console.error("❌ Failed to delete temp file:", cleanupError.message);
      }
      const duration = Date.now() - start;
      // Track STT usage for Whisper.
      aiMetricsService.trackSTTUsage("whisper", duration);
    }
  }

  /**
   * Generate speech from text using Google Text-to-Speech (TTS)
   * @param {string} text - Text to convert to speech
   * @param {string} chatId - Chat ID (for logging if needed)
   * @returns {Promise<Buffer>} - Generated audio buffer
   */
  /**
   * Create Google TTS key file at the specified path
   * @param {string} filePath - Path where the key file should be created
   */
  createGoogleTTSKeyFile(filePath) {
    try {
      // Ensure the directory exists
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (!fs.existsSync(dir)) {
        console.log(`📁 Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create the key file with placeholder content
      const keyFileContent = JSON.stringify({
        "type": "service_account",
        "project_id": "katz-speech-to-text",
        "private_key_id": "...",
        "private_key": "...",
        "client_email": "...",
        "client_id": "...",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": "..."
      }, null, 2);

      fs.writeFileSync(filePath, keyFileContent, { mode: 0o600 });
      console.log(`✅ Created Google TTS key file at: ${filePath}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to create key file at ${filePath}:`, error.message);
      return false;
    }
  }

  async synthesizeGoogle(text, chatId) {
    const languageCode = "en-US";
    const voiceName = "en-US-Neural2-J";
    const start = Date.now();
    
    try {
      console.log("Google TTS Input Text:", text);
      
      // Check if TTS client is available
      if (!this.ttsClient) {
        console.log("❌ Google TTS client not initialized. Attempting to reinitialize...");
        
        // Try to reinitialize with proper path handling
        this.initGoogleClients();
        
        if (!this.ttsClient) {
          throw new Error("Google TTS client unavailable after reinitialization.");
        }
      }
      
      const request = {
        input: { text },
        voice: { languageCode, ssmlGender: 'MALE', name: voiceName },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          speakingRate: 1.1,
          pitch: 9,
          volumeGainDb: 6.0,
          sampleRateHertz: 48000,
        },
      };
      
      // Check for OpenSSL/Certificate errors by making a test API call
      try {
        const [response] = await this.ttsClient.synthesizeSpeech(request);
        if (response.audioContent) {
          console.log("✅ Google TTS succeeded");
          return Buffer.from(response.audioContent, 'binary');
        } else {
          console.log("❌ No audio content received from TTS service.");
          throw new Error("No audio content received");
        }
      } catch (apiError) {
        // Check if this is an OpenSSL certificate error
        if (apiError.message.includes('DECODER') || 
            apiError.message.includes('certificate') || 
            apiError.message.includes('metadata from plugin failed')) {
          console.error("❌ Google TTS OpenSSL Certificate Error:", apiError.message);
          console.error("⚠️ Credential file likely has invalid certificate format. Falling back to ElevenLabs.");
          
          // Fall back to ElevenLabs TTS
          console.log("🔄 Falling back to ElevenLabs TTS");
          return await this.synthesizeSpeech(text);
        }
        
        // Rethrow other API errors
        throw apiError;
      }
    } catch (error) {
      console.error("❌ Google TTS Error:", error.message);
      console.error("❌ Stack trace:", error.stack);
      
      // Provide more detailed error information
      if (error.message.includes('ENOENT')) {
        console.error("❌ This appears to be a credentials file issue. Check:");
        console.error("   - GOOGLE_API_KEY_FILE environment variable is set");
        console.error("   - The credentials file exists and is readable");
        console.error("   - The file contains valid JSON service account credentials");
        console.error(`   - Current GOOGLE_API_KEY_FILE value: ${config.googleApiKeyFile}`);
        
        // Try to diagnose the file system issue
        try {
          const keyFile = config.googleApiKeyFile;
          if (keyFile) {
            const dir = path.dirname(keyFile);
            console.error(`   - Directory exists: ${fs.existsSync(dir)}`);
            console.error(`   - File exists: ${fs.existsSync(keyFile)}`);
            if (fs.existsSync(keyFile)) {
              const stats = fs.statSync(keyFile);
              console.error(`   - File size: ${stats.size} bytes`);
              console.error(`   - File permissions: ${stats.mode.toString(8)}`);
            }
          }
        } catch (diagError) {
          console.error(`   - Error during file system diagnosis: ${diagError.message}`);
        }
      }
      
      throw new Error("Failed to synthesize and send speech.");
    } finally {
      const duration = Date.now() - start;
      // Track TTS usage for Google TTS.
      aiMetricsService.trackTTSUsage("google-tts", duration);
    }
  }

  /**
   * Generate speech from text using ElevenLabs (TTS)
   */
  async synthesizeSpeech(text, voice_id = this.defaultVoice, model = this.defaultModel) {
    const start = Date.now();
    console.log("ElevenLabs input text:", text);
    try {
      const audioBuffer = await this.elevenLabs.generate({
        text,
        voice_id,
        model_id: model,
      });
      return audioBuffer;
    } catch (error) {
      console.error("❌ ElevenLabs TTS Error:", error.message);
      throw new Error("Failed to synthesize speech.");
    } finally {
      const duration = Date.now() - start;
      // Track TTS usage for ElevenLabs TTS.
      aiMetricsService.trackTTSUsage("elevenlabs-tts", duration);
    }
  }

  /**
   * Save audio to a file.
   */
  saveAudioToFile(audioBuffer, filePath) {
    try {
      fs.writeFileSync(filePath, audioBuffer);
      console.log(`✅ Audio saved to ${filePath}`);
    } catch (error) {
      console.error("❌ Error saving audio file:", error.message);
      throw new Error("Failed to save audio file.");
    }
  }
}
