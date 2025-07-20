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
    this.speechClient = new SpeechClient({
      keyFilename: config.googleApiKeyFile, 
    });
    this.ttsClient = new textToSpeech.TextToSpeechClient({
      keyFilename: config.googleApiKeyFile, 
    });
    this.defaultModel = "eleven_multilingual_v2"; // Default model for ElevenLabs multilingual support
    this.defaultVoice = "N2lVS1w4EtoT3dr4eOWO"; // Default ElevenLabs voice
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
      
      // Check if TTS client is available
      if (!this.ttsClient) {
        console.error("❌ Google TTS client not initialized. Attempting to reinitialize...");
        this.ttsClient = this.initializeGoogleTTSClient();
        
        if (!this.ttsClient) {
          throw new Error("Google TTS client unavailable. Check credentials configuration.");
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
