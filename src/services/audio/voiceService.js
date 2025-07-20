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
    
    // Initialize Google clients with flexible configuration handling
    try {
      const googleCredentials = this.resolveGoogleCredentials();
      console.log(`✅ Using Google credentials from: ${googleCredentials.source}`);
      
      this.speechClient = new SpeechClient(googleCredentials.config);
      this.ttsClient = new textToSpeech.TextToSpeechClient(googleCredentials.config);
    } catch (error) {
      console.error("❌ Failed to initialize Google clients:", error.message);
      // Still create the services, they'll throw more specific errors when used
      this.speechClient = new SpeechClient({});
      this.ttsClient = new textToSpeech.TextToSpeechClient({});
    }
    
    this.defaultModel = "eleven_multilingual_v2"; // Default model for ElevenLabs multilingual support
    this.defaultVoice = "N2lVS1w4EtoT3dr4eOWO"; // Default ElevenLabs voice
  }
  
  /**
   * Resolve Google credentials using multiple fallback methods
   * @returns {Object} Object with config and source properties
   */
  resolveGoogleCredentials() {
    // Try environment variable path first
    if (config.googleApiKeyFile) {
      const keyPath = config.googleApiKeyFile;
      if (fs.existsSync(keyPath)) {
        return {
          config: { keyFilename: keyPath },
          source: `environment variable (${keyPath})`
        };
      }
      console.warn(`⚠️ Key file specified in environment variable not found: ${keyPath}`);
    }
    
    // Try relative path to config directory (for both dev and prod)
    const possiblePaths = [
      path.join(process.cwd(), 'config/katz-speech-to-text-key.json'),
      './config/katz-speech-to-text-key.json',
      '../config/katz-speech-to-text-key.json',
      '/usr/src/app/config/katz-speech-to-text-key.json'
    ];
    
    for (const keyPath of possiblePaths) {
      if (fs.existsSync(keyPath)) {
        return {
          config: { keyFilename: keyPath },
          source: `found file (${keyPath})`
        };
      }
    }
    
    // If we still haven't found it and we're in a docker container, 
    // try to use credentials from environment variable directly
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      try {
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        return {
          config: { credentials },
          source: 'GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable'
        };
      } catch (error) {
        console.warn('⚠️ Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', error.message);
      }
    }
    
    throw new Error('Could not resolve Google credentials from any source');
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
  async synthesizeGoogle(text, chatId) {
    const languageCode = "en-US";
    const voiceName = "en-US-Neural2-J";
    const start = Date.now();
    try {
      console.log("Google TTS Input Text:", text);
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
      const [response] = await this.ttsClient.synthesizeSpeech(request);
      if (response.audioContent) {
        console.log("✅ Google TTS succeeded");
        return Buffer.from(response.audioContent, 'binary');
      } else {
        console.log("❌ No audio content received from TTS service.");
        return null;
      }
    } catch (error) {
      console.error("❌ Google TTS Error:", error.message);
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