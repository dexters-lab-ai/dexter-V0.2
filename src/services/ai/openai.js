import OpenAI, { toFile } from 'openai';
import axios from 'axios';
import sharp from 'sharp';
import { config } from '../../core/config.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { systemPrompts } from './prompts.js';

const MAX_IMAGE_SIZE = 1 * 1024 * 1024; // 1MB

/**
 * Compresses and resizes the image if it exceeds the maximum allowed size.
 * Ensures the output is a PNG.
 * @param {Buffer} imageBuffer - The original image buffer.
 * @returns {Promise<Buffer>} - The processed image buffer.
 */
async function compressImageIfNeeded(imageBuffer) {
  if (imageBuffer.length > MAX_IMAGE_SIZE) {
    console.warn(
      `Image size ${imageBuffer.length} bytes exceeds limit of ${MAX_IMAGE_SIZE} bytes. Compressing and resizing...`
    );
    const compressedBuffer = await sharp(imageBuffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .png({ quality: 80 })
      .toBuffer();
    console.log(`Compressed image size: ${compressedBuffer.length} bytes`);
    return compressedBuffer;
  }
  console.log(`Image size is within limits: ${imageBuffer.length} bytes`);
  // Ensure output is PNG
  return await sharp(imageBuffer).png().toBuffer();
}

/**
 * Fetches an image buffer from a URL with improved error handling.
 * @param {string} url - The image URL.
 * @returns {Promise<Buffer>} - The fetched image buffer.
 */
async function fetchImageBuffer(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000, // 10 seconds timeout
    });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch image. Status code: ${response.status}`);
    }
    return Buffer.from(response.data, 'binary');
  } catch (error) {
    if (error instanceof AggregateError) {
      for (const individualError of error.errors) {
        console.error('Individual fetch error:', individualError.message);
      }
    } else if (error.response) {
      console.error(
        `❌ Error fetching image buffer: ${error.response.status} - ${error.response.statusText}`
      );
    } else if (error.request) {
      console.error('❌ Error fetching image buffer: No response received', error.request);
    } else {
      console.error('❌ Error fetching image buffer:', error.message || error);
    }
    throw error;
  }
}

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.isConnected = false;
    this.conversationHistory = new Map();
  }

  async testConnection() {
    try {
      await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 10,
      });
      this.isConnected = true;
      return true;
    } catch (error) {
      this.isConnected = false;
      console.error('Failed to connect to OpenAI:', error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async createChatCompletion({ model, messages, functions, function_call }) {
    try {
      if (!this.isConnected) await this.testConnection();
      const response = await this.openai.chat.completions.create({
        model,
        messages,
        functions,
        function_call,
      });
      if (!response || !response.choices || response.choices.length === 0) {
        throw new Error('Invalid response from OpenAI API');
      }
      return response;
    } catch (error) {
      console.error('❌ Error in createChatCompletion:', error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async generateAIResponse(messages, purpose = 'chat') {
    try {
      if (!this.isConnected) await this.testConnection();
      const formattedMessages = this.formatMessages(messages, purpose);
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: formattedMessages,
        max_tokens: 500,
        temperature: 0.7,
        presence_penalty: 0.6,
        frequency_penalty: 0.5,
      });
      return response.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI Error:', error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  formatMessages(messages, purpose) {
    if (!messages) throw new Error('Messages cannot be null or undefined');
    const defaultSystemPrompt = systemPrompts[purpose] || systemPrompts.general;
    if (Array.isArray(messages) && messages.every(msg => msg.role && typeof msg.content === 'string')) {
      if (!messages.some(msg => msg.role === 'system')) {
        messages.unshift({ role: 'system', content: defaultSystemPrompt });
      }
      return messages;
    }
    if (Array.isArray(messages)) {
      const formattedMessages = messages.map(msg =>
        typeof msg === 'string'
          ? { role: 'user', content: msg }
          : { role: msg.role || 'user', content: msg.content ? String(msg.content) : '' }
      );
      formattedMessages.unshift({ role: 'system', content: defaultSystemPrompt });
      return formattedMessages;
    }
    if (typeof messages === 'string') {
      return [
        { role: 'system', content: defaultSystemPrompt },
        { role: 'user', content: messages },
      ];
    }
    if (typeof messages === 'object' && messages.content !== undefined) {
      return [
        { role: 'system', content: defaultSystemPrompt },
        { role: messages.role || 'user', content: String(messages.content) },
      ];
    }
    throw new Error('Invalid messages format');
  }

  updateConversationHistory(userId, messages, reply) {
    if (!userId) return;
    const history = this.conversationHistory.get(userId) || [];
    const updatedHistory = [...history];
    if (Array.isArray(messages)) {
      updatedHistory.push(
        ...messages.map(msg => ({
          role: msg.role || 'user',
          content: typeof msg.content === 'string' ? msg.content : String(msg.content),
        }))
      );
    } else if (typeof messages === 'string') {
      updatedHistory.push({ role: 'user', content: messages });
    }
    if (reply) {
      updatedHistory.push({ role: 'assistant', content: typeof reply === 'string' ? reply : String(reply) });
    }
    while (updatedHistory.length > 10) {
      updatedHistory.shift();
    }
    this.conversationHistory.set(userId, updatedHistory);
  }

  /**
   * Creates an image edit using OpenAI's image editing endpoint.
   * Both the image and mask are saved as fully formed files (multipart/form-data)
   * meeting the requirements: square PNG, 1024x1024 (or allowed size), 8-bit RGBA.
   * If no mask is provided, a fully transparent mask matching the image dimensions is generated.
   *
   * @param {Object} params
   * @param {string} params.prompt - A text description of the desired image.
   * @param {Buffer} params.image - The image buffer (will be converted to a file).
   * @param {Buffer|null} [params.mask=null] - Optional mask buffer (will be converted to a file) or null.
   * @param {number} [params.n=1] - The number of images to generate.
   * @param {string} [params.size='1024x1024'] - The output image size.
   * @returns {Promise<Object>} - The API response.
   */
  async createImageEdit({ prompt, image, mask = null, n = 1, size = '1024x1024' }) {
    try {
      // Process the image and ensure PNG format.
      const processedImage = await compressImageIfNeeded(image);
      // Convert buffer to a file for multipart/form-data
      const imageFile = await toFile(processedImage);
      
      // Prepare the mask.
      let finalMask = mask;
      if (mask !== null) {
        // If a mask is provided, ensure it has matching dimensions.
        if (!mask.name) mask.name = 'mask.png';
        const [maskMeta, imageMeta] = await Promise.all([
          sharp(mask).metadata(),
          sharp(processedImage).metadata(),
        ]);
        if (maskMeta.width !== imageMeta.width || maskMeta.height !== imageMeta.height) {
          console.warn('Provided mask dimensions do not match image dimensions. Resizing mask...');
          finalMask = await sharp(mask)
            .resize(imageMeta.width, imageMeta.height)
            .png()
            .toBuffer();
          finalMask.name = 'mask.png';
        }
      } else {
        // No mask provided: generate a fully transparent mask matching the image dimensions.
        const imageMeta = await sharp(processedImage).metadata();
        if (!imageMeta.width || !imageMeta.height) {
          throw new Error('Could not determine image dimensions for mask generation.');
        }
        finalMask = await sharp({
          create: {
            width: imageMeta.width,
            height: imageMeta.height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .png()
          .toBuffer();
        finalMask.name = 'mask.png';
      }
      const maskFile = await toFile(finalMask);

      // Call the OpenAI image edit endpoint.
      const response = await this.openai.images.edit({
        model: 'dall-e-2', // Edits currently support DALL·E 2 only.
        image: imageFile,
        mask: maskFile,
        prompt,
        n,
        size,
        response_format: 'url',
      });
      return response;
    } catch (error) {
      console.error('❌ Error in createImageEdit:', error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Creates image variations using OpenAI's image variations endpoint.
   * (The API does not accept a mask for variations.)
   *
   * @param {Object} params
   * @param {Buffer} params.image - The image buffer (will be converted to a file).
   * @param {number} [params.n=1] - The number of images to generate.
   * @param {string} [params.size='1024x1024'] - The output image size.
   * @returns {Promise<Object>} - The API response.
   */
  async createImageVariation({ image, n = 1, size = '1024x1024' }) {
    try {
      const processedImage = await compressImageIfNeeded(image);
      const imageFile = await toFile(processedImage);
      const response = await this.openai.images.createVariation({
        model: 'dall-e-2',
        image: imageFile,
        n,
        size,
        response_format: 'url',
      });
      return response;
    } catch (error) {
      console.error('❌ Error in createImageVariation:', error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  clearConversationHistory(userId) {
    this.conversationHistory.delete(userId);
  }
}

export const openAIService = new OpenAIService();
export { fetchImageBuffer };
