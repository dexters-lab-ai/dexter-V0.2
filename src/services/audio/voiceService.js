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

// Base64 encoded credentials for Google Speech-to-Text
const STT_CREDENTIALS_BASE64 = fs.readFileSync('./stt-credentials-base64.txt', 'utf8').trim();

const openai = new OpenAI();

export class VoiceService {
  constructor(bot) {
    this.bot = bot;
    this.elevenLabs = new ElevenLabsClient({
      apiKey: config.elevenLabsApiKey,
    });
    
    // Initialize Google clients with base64 encoded credentials
    try {
      // Use base64 encoded credentials directly
      const credentials = JSON.parse(Buffer.from(STT_CREDENTIALS_BASE64, 'base64').toString());
      
      console.log(`✅ Using Google credentials from base64 encoded string`);
      
      // Initialize with the credentials object
      this.speechClient = new SpeechClient({
        credentials
      });
      this.ttsClient = new textToSpeech.TextToSpeechClient({
        credentials
      });
      
      console.log(`✅ Successfully initialized Google clients with base64 credentials`);
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
   * Finds a valid Google credentials file by checking multiple possible paths
   * @param {string} configPath - Path from config
   * @returns {string} - The path to a valid credentials file
   */
  findCredentialsFile(configPath) {
    // Try the config path first
    if (configPath && fs.existsSync(configPath)) {
      return configPath;
    }

    // Check various possible paths for the key file
    const possiblePaths = [
      // Docker production paths
      '/usr/src/app/config/katz-speech-to-text-key.json',
      
      // Local development paths
      './config/katz-speech-to-text-key.json',
      path.join(process.cwd(), 'config/katz-speech-to-text-key.json'),
      path.join(process.cwd(), '/config/katz-speech-to-text-key.json'),
      '../config/katz-speech-to-text-key.json',
      
      // Absolute path from project root
      path.resolve(__dirname, '../../../config/katz-speech-to-text-key.json')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        console.log(`✅ Found credentials file at: ${p}`);
        return p;
      }
    }

    // If we get here, we couldn't find the file
    // Just return the config path and let the Google client handle the error
    console.warn(`⚠️ Could not find credentials file at any location, falling back to: ${configPath}`);
    return configPath || './config/katz-speech-to-text-key.json';
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