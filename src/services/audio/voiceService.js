import { ElevenLabsClient } from "elevenlabs";
import { SpeechClient } from "@google-cloud/speech";
import { config } from "../../core/config.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";
import textToSpeech from "@google-cloud/text-to-speech";

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

  /**
   * Exponential Backoff Retry Helper
   */
  async retryWithBackoff(fn, retries = 7, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        console.warn(`⚠️ Attempt ${i + 1} failed: ${error.message}`);
        if (i < retries - 1) {
          await new Promise((res) => setTimeout(res, delay * Math.pow(2, i))); // Exponential backoff
        } else {
          throw error; // Final failure
        }
      }
    }
  }

  /**
   * Transcribe voice message to text using Google Speech-to-Text (with retry)
   * @param {string} voiceUrl - Telegram file URL for the voice message
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribeVoice(voiceUrl) {
    return this.retryWithBackoff(async () => {
      try {
        // Download the voice file from Telegram
        const response = await axios.get(voiceUrl, { responseType: "arraybuffer" });
        const audioBuffer = Buffer.from(response.data);

        // Configure Google Speech-to-Text request
        const request = {
          audio: { content: audioBuffer.toString("base64") },
          config: {
            encoding: "OGG_OPUS", // Telegram sends voice messages in OGG Opus format
            sampleRateHertz: 16000,
            languageCode: "en-US", // Set desired language
          },
        };

        // Perform transcription
        const [operation] = await this.speechClient.recognize(request);
        const transcription = operation.results
          .map((result) => result.alternatives[0].transcript)
          .join(" ");

        return transcription;
      } catch (error) {
        console.error("❌ Google STT Error:", error.message);
        throw new Error("Failed to transcribe voice message.");
      }
    });
  }

  /**
   * Transcribe voice using OpenAI Whisper API (with retry)
   * @param {string} fileUrl - Telegram voice message file URL
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribeVoiceWhisp(fileUrl) {
    return this.retryWithBackoff(async () => {
      const tempDir = os.tmpdir();
      const filePath = path.join(tempDir, "voice_message.ogg");

      try {
        // Fetch the audio file from Telegram
        const response = await axios.get(fileUrl, { responseType: "arraybuffer" });

        // Save the file to the temporary directory
        fs.writeFileSync(filePath, response.data);

        // Transcribe using Whisper API
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: "whisper-1",
          prompt: "transcribe audio with high accuracy. These are some phrases you will hear: BTC, AI, crypto, search, google, meme, morad, CZ, Vitalik, quant, ticker, scan, buy, ape, ummmm let me think like hmmm...okay heres what im thinking, REKT, rug, RUG, mindshare, COOKIE, trends, umm what else, okay find me, okay scan, okay analyze, okay google, okay please search for, whats trending on X, trenches, hey, ayt, cool, nah, ey, yikes, oops, maaan, yo wtf, tha heck"
        });

        return transcription.text.trim();
      } catch (error) {
        console.error("❌ Whisper transcription error:", error.message);
        throw new Error("Failed to transcribe the voice message.");
      } finally {
        // Clean up: Remove the temporary file
        try {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Deleted temp file: ${filePath}`);
        } catch (cleanupError) {
          console.error("❌ Failed to delete temp file:", cleanupError.message);
        }
      }
    });
  }

  /**
   * Generate speech from text using Google Text-to-Speech
   * @param {string} text - Text to convert to speech
   * @param {string} languageCode - Language code (e.g., "en-GB")
   * @param {string} voiceName - Voice name (e.g., "en-GB-News-H")
   * @returns {Promise<Buffer>} - Generated audio in LINEAR16 format
   */
  
  async synthesizeGoogle(text, chatId) {
    const languageCode = "en-US";
    const voiceName = "en-US-Neural2-J";
    try {
      console.log("Google TTS Input Text:", text);

      const request = {
        input: { text },
        voice: { 
          languageCode: languageCode,
          ssmlGender: 'MALE',
          name: voiceName, 
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          speakingRate: 1.1,
          pitch: 9, 
          volumeGainDb: 6.0,
          sampleRateHertz: 48000,
        },
      };

      // Generate speech
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
    }
  }

  /**
   * Generate speech from text using ElevenLabs
   */
  async synthesizeSpeech(text, voice_id = this.defaultVoice, model = this.defaultModel) {
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
    }
  }

  /**
   * Save audio to a file
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
