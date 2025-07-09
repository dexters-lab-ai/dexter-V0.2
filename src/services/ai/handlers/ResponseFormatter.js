export class OpenAIErrorHandler {
    static async handleError(error, retryCount = 0) {
      // Rate limit handling
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'] || 60;
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return { shouldRetry: retryCount < 2 };
      }
  
      // Invalid request handling
      if (error.response?.status === 400) {
        return { 
          shouldRetry: false,
          fallbackResponse: "I couldn't understand that request. Please try again."
        };
      }
  
      // Timeout handling
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return { shouldRetry: retryCount < 1 };
      }
  
      // Default error handling
      return { 
        shouldRetry: false,
        fallbackResponse: "I'm having trouble processing that right now. Please try again later."
      };
    }
  }
  