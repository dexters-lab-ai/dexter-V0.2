import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderSentinelPage, searchSentinel, getSearchStatus, saveSearchResult, getSavedResult, processVoiceInput, getUserSearchHistory } from '../core/sentinel/SentinelAPI.js';
import { geminiService } from '../services/ai/geminiService.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve SENTINEL static files (JS modules and CSS)
router.use('/static', express.static(path.join(__dirname, '../core/sentinel'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

/**
 * Main route for the SENTINEL API page
 * Renders the UI for the SENTINEL search interface
 */
router.get('/', async (req, res) => {
  try {
    const htmlContent = await renderSentinelPage();
    res.status(200).send(htmlContent);
  } catch (error) {
    console.error('Error rendering SENTINEL page:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>SENTINEL API Error</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="background:#111;color:#f33;">
          <h1>SENTINEL Error</h1>
          <p>Failed to load SENTINEL API: ${error.message}</p>
        </body>
      </html>
    `);
  }
});

/**
 * Search endpoint that accepts:
 * - Text queries (natural language)
 * - Contract addresses (for tokens)
 * - URLs (for scraping)
 */
router.post('/search', async (req, res) => {
  try {
    const { query, type, walletAddress } = req.body;
    
    // If query is empty or missing, fallback to AI streaming
    if (!query || query.trim() === '') {
      console.log('🤖 Empty query detected - falling back to AI streaming');
      
      // Set up streaming response headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Build a prompt that asks the AI to guide the user
      const prompt = `You are SENTINEL AI, a helpful assistant with access to tools.
      You can search the web for current information or use SENTINEL's crypto search capabilities.
      The user submitted an empty search. Please ask what they would like to know about and offer some suggestions.
      Respond conversationally and offer to help with cryptocurrency information, market data, or general questions.`;
      
      // Set up tool call handler (reuse from chat endpoint)
      const handleToolCall = async (toolName, args) => {
        console.log(`🔧 Tool call in empty search fallback: ${toolName}`, args);
        
        res.write(`data: ${JSON.stringify({ type: 'tool_start', tool: toolName, args: args })}

`);
        
        try {
          let result = "No results found";
          
          // Handle Google search tool
          if (toolName === 'google_search' && args.query) {
            res.write(`data: ${JSON.stringify({ type: 'status', message: `Searching the web for: ${args.query}` })}

`);
            result = `Web search results for: ${args.query}\n[This is where actual search results would appear]`;
          }
          
          // Handle SENTINEL search tool for token information
          else if (toolName === 'sentinel_search' && args.token) {
            const includeSocial = args.include_social === true;
            res.write(`data: ${JSON.stringify({ type: 'status', message: `Searching for token: ${args.token}` })}

`);
            
            try {
              let searchType = 'text';
              if (args.token.length > 30) {
                searchType = 'contract';
              }
              
              const searchResults = await searchSentinel(args.token, searchType);
              
              if (searchResults && searchResults.results) {
                let formattedResults = [];
                
                if (searchResults.results.tokenInfo) {
                  const token = searchResults.results.tokenInfo;
                  formattedResults.push(`**${token.name} (${token.symbol})**`);
                  formattedResults.push(`Price: ${token.price || 'Unknown'}`);
                  formattedResults.push(`Change 24h: ${token.priceChange24h || 'Unknown'}`);
                  formattedResults.push(`Market Cap: ${token.marketCap || 'Unknown'}`);
                }
                
                if (searchResults.results.security) {
                  const security = searchResults.results.security;
                  formattedResults.push(`\n**Security Score**: ${security.score || 'Unknown'}/100`);
                }
                
                if (includeSocial && searchResults.results.social) {
                  formattedResults.push(`\n**Recent Activity**: Found ${searchResults.results.social.length || 0} social posts`);
                }
                
                result = formattedResults.join('\n');
                if (result.trim() === '') {
                  result = `No detailed information found for token: ${args.token}`;
                }
              } else {
                result = `No information found for token: ${args.token}`;
              }
            } catch (searchError) {
              console.error('Error in sentinel_search tool:', searchError);
              result = `Error searching for token: ${searchError.message}`;
            }
          }
          
          res.write(`data: ${JSON.stringify({ type: 'tool_result', tool: toolName, result: result })}

`);
          return result;
        } catch (error) {
          console.error(`Error handling tool ${toolName}:`, error);
          res.write(`data: ${JSON.stringify({ type: 'tool_error', tool: toolName, error: error.message })}

`);
          return `Error using ${toolName}: ${error.message}`;
        }
      };
      
      // Stream AI response with tool call support
      const aiResponse = await geminiService.streamTextContent(
        prompt, 
        [], // Empty history for now
        (chunk) => {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}

`);
        },
        handleToolCall // Pass the tool call handler
      );
      
      // Send completion status
      res.write(`data: ${JSON.stringify({ 
        type: 'complete', 
        summary: aiResponse.text,
      })}

`);
      
      res.end();
      return;
    }
    
    // Normal search processing if query exists
    const results = await searchSentinel(query, type);
    res.status(200).json(results);
  } catch (error) {
    console.error('Error in SENTINEL search:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * AI streaming endpoint for real-time AI analysis
 * Streams AI responses as they are generated
 */
/**
 * General purpose AI chat endpoint with dynamic tool calling
 * Streams AI responses for conversational queries and automatically invokes tools based on context
 * Implements the official Gemini streaming function-calling pattern
 */
router.post('/chat', async (req, res) => {
  try {
    const { query, history = [], walletAddress } = req.body;

    // Input validation
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Wallet address is required. Please connect your wallet to use SENTINEL.' 
      });
    }

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Helper to send SSE data
    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Initial status
    sendEvent({ type: 'status', message: 'SENTINEL is thinking...' });
    
    // Log the query for debugging
    console.log(`💬 Chat request from ${walletAddress.slice(0, 8)}... with query: ${query}`);
    
    // Define our tool handler - this will execute when Gemini calls a tool
    const handleToolCall = async (toolName, args) => {
      console.log(`🔧 Tool call requested: ${toolName}`, JSON.stringify(args));
      sendEvent({ type: 'tool_start', tool: toolName, args });

      try {
        let result = null;

        // Execute the requested tool
        if (toolName === 'google_search' && args.query) {
          sendEvent({ type: 'status', message: `Searching the web for: ${args.query}` });
          try {
            // Production implementation would call an actual search API
            // For now, return mock results that look realistic
            result = {
              query: args.query,
              searchResults: [
                {
                  title: `Results for: ${args.query}`,
                  snippet: `This would contain actual search results for "${args.query}" from a production search API.`,
                  url: 'https://example.com/search-result-1'
                },
                {
                  title: 'Related Information',
                  snippet: 'Additional context and related information would appear here.',
                  url: 'https://example.com/search-result-2'
                }
              ]
            };
          } catch (searchError) {
            console.error('Error in google_search:', searchError);
            result = { error: `Search failed: ${searchError.message}` };
          }
        } 
        else if (toolName === 'sentinel_search' && args.token) {
          sendEvent({ type: 'status', message: `Analyzing token: ${args.token}` });
          
          try {
            // Remove any $ symbol from cashtags
            const cleanToken = args.token.replace(/^\$/, '');
            
            // Determine if this is a contract address or a symbol/text query
            const searchType = cleanToken.length > 30 ? 'contract' : 'text';
            console.log(`🔍 Searching for token "${cleanToken}" as type: ${searchType}`);
            
            // Call our existing search function with the cleaned token
            const searchResults = await searchSentinel(cleanToken, searchType);
            
            // Return raw results for Gemini to format
            if (searchResults && searchResults.results) {
              result = searchResults.results;
              console.log(`✅ Found results for token: ${cleanToken}`, 
                Object.keys(searchResults.results).length + ' categories of data');
            } else {
              console.log(`⚠️ No results found for token: ${cleanToken}`);
              result = { error: `No information found for token: ${cleanToken}` };
            }
          } catch (searchError) {
            console.error('❌ Error in sentinel_search tool:', searchError);
            result = { error: searchError.message };
          }
        }
        else if (toolName === 'sentinel_url_analyzer' && args.url) {
          sendEvent({ type: 'status', message: `Analyzing URL: ${args.url}` });
          
          try {
            // Validate URL format
            if (!args.url.match(/^https?:\/\//i)) {
              throw new Error('Invalid URL format. Must start with http:// or https://');
            }
            
            console.log(`🌐 Analyzing URL: ${args.url}`);
            
            // Call our existing URL scraper functionality 
            const urlResults = await searchSentinel(args.url, 'url');
            
            // Return results for Gemini to format
            if (urlResults && urlResults.results) {
              result = urlResults.results;
              console.log(`✅ Successfully analyzed URL: ${args.url}`);
            } else {
              console.log(`⚠️ No content extracted from URL: ${args.url}`);
              result = { error: `Could not extract content from URL: ${args.url}` };
            }
          } catch (urlError) {
            console.error('❌ Error in sentinel_url_analyzer:', urlError);
            result = { error: urlError.message };
          }
        }

        // Send results to client and return to Gemini
        if (result) {
          sendEvent({ type: 'tool_result', tool: toolName, result });
          return result;
        } else {
          throw new Error('Tool execution failed or returned no results');
        }
      } catch (error) {
        console.error(`Error executing ${toolName}:`, error);
        sendEvent({ type: 'tool_error', tool: toolName, error: error.message });
        return { error: error.message };
      }
    };

    // Stream AI response with tool call support
    const aiResponse = await geminiService.streamTextContent(
      query, // Pass the user's query directly
      history, // Use the conversation history if provided
      (chunk) => {
        // Stream thinking and text chunks to the client
        sendEvent({ type: 'chunk', content: chunk });
      },
      handleToolCall // Pass the tool call handler for dynamic tool execution
    );

    // Send completion status
    sendEvent({ 
      type: 'complete', 
      summary: aiResponse.text,
      toolsUsed: aiResponse.toolCalls && aiResponse.toolCalls.length > 0,
      toolCalls: aiResponse.toolCalls
    });
    
    res.end();
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    
    // Handle error response depending on whether headers have been sent
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}

`);
      res.end();
    }
  }
});

/**
 * Endpoint for raw data view
 */
router.get('/raw/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    // Fetch raw search results by ID from storage/cache
    const searchResults = await getSearchStatus(id);
    
    if (!searchResults) {
      return res.status(404).json({ error: 'Search results not found' });
    }
    
    res.status(200).json(searchResults);
  } catch (error) {
    console.error('Error fetching raw SENTINEL data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Endpoint for saving search results
 * Requires wallet address for user identification
 */
router.post('/save', async (req, res) => {
  try {
    const { id, notes, walletAddress } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Wallet address is required. Please connect your wallet to use SENTINEL.' 
      });
    }
    
    // Get the search data from the cache or search history
    const searchResults = await getSearchStatus(id);
    
    if (!searchResults || !searchResults.results) {
      return res.status(404).json({ error: 'Search results not found' });
    }
    
    // Add notes and wallet address to the search data
    const dataToSave = {
      ...searchResults,
      notes: notes || '',
      walletAddress
    };
    
    // Save the search results with user's wallet address
    const savedResult = await saveSearchResult(id, dataToSave, walletAddress);
    res.status(200).json(savedResult);
  } catch (error) {
    console.error('Error saving SENTINEL results:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Status endpoint to check progress of ongoing searches
 * This is used by the frontend polling mechanism
 */
router.get('/status', async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    // Get the current status of the search
    const status = await getSearchStatus(id);
    res.status(200).json(status);
  } catch (error) {
    console.error('Error fetching SENTINEL search status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Retrieve endpoint to get saved search results by ID
 * Used by the frontend to display past searches from history
 * Requires wallet address for user identification
 */
router.get('/retrieve/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { walletAddress } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Wallet address is required. Please connect your wallet to use SENTINEL.' 
      });
    }
    
    // Get the saved results from the database for this specific wallet address
    const results = await getSavedResult(id, walletAddress);
    
    if (!results) {
      return res.status(404).json({ error: 'Search results not found for your wallet' });
    }
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Error retrieving saved SENTINEL results:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Voice endpoint to process audio data from the frontend
 * Uses Gemini API for speech-to-text processing
 */
router.post('/voice', async (req, res) => {
  try {
    const { audio } = req.body;
    
    if (!audio) {
      return res.status(400).json({ 
        success: false, 
        error: 'Audio data is required' 
      });
    }
    
    // Process audio data with Gemini
    const result = await processVoiceInput(audio);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to process audio'
      });
    }
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error processing voice input:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * History endpoint to get all search history for a user by wallet address
 * Enforces wallet connection requirement and respects history limit
 */
router.get('/history', async (req, res) => {
  try {
    const { walletAddress } = req.query;
    
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Wallet address is required. Please connect your wallet to use SENTINEL.' 
      });
    }
    
    // Get all search history for this wallet address
    const history = await getUserSearchHistory(walletAddress);
    
    // Return the search history (will be empty array if none found)
    res.status(200).json({
      walletAddress,
      history,
      count: history.length
    });
  } catch (error) {
    console.error('Error retrieving SENTINEL search history:', error);
    res.status(500).json({ error: error.message });
  }
});



/**
 * AI streaming endpoint for real-time AI analysis of search results
 * Streams AI responses as they are generated
 */
router.post('/ai-stream', async (req, res) => {
  try {
    const { query, results, walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Wallet address is required. Please connect your wallet to use SENTINEL.' 
      });
    }
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required for AI analysis' });
    }
    
    // Set up Server-Sent Events (SSE) for streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Send initial status
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'AI analysis starting...' })}\n\n`);
    
    try {
      const geminiService = require('../services/gemini/geminiService');
      
      // Prepare context for AI analysis
      const context = {
        query: query,
        hasTokenInfo: !!results.tokenInfo && !results.tokenInfo.error,
        hasTokenMetadata: !!results.tokenMetadata,
        hasSocialData: !!results.socialData && !results.socialData.error,
        hasSecurityAnalysis: !!results.securityAnalysis
      };
      
      // Build summary data for AI analysis
      let summaryData = '';
      let hasData = false;

      if (context.hasTokenMetadata) {
        const { holders, price } = results.tokenMetadata;
        if (holders && price?.data) {
          hasData = true;
          summaryData += `Token: ${holders.tokenName} (${holders.tokenSymbol})\n`;
          summaryData += `Price: $${price.data.usdPrice || holders.currentUsdPrice}\n`;
          summaryData += `24h Change: ${price.data.usdPrice24hrPercentChange || holders.pricePercentChange?.['24h']}%\n`;
          summaryData += `Holders: ${holders.totalHolders}\n`;
          summaryData += `Market Cap: $${holders.marketCap}\n\n`;
        }
      }

      if (context.hasSocialData && results.socialData.tweets?.length > 0) {
        hasData = true;
        summaryData += `Social Activity: Found ${results.socialData.tweets.length} recent tweets\n`;
        const sentiments = results.socialData.tweets.map(t => t.sentiment).filter(s => s && s !== 'NA');
        if (sentiments.length > 0) {
          const sentimentCounts = sentiments.reduce((acc, s) => {
            acc[s] = (acc[s] || 0) + 1;
            return acc;
          }, {});
          summaryData += `Sentiment Analysis: ${JSON.stringify(sentimentCounts)}\n\n`;
        }
      }

      let prompt;
      if (hasData) {
        // AI prompt for streaming analysis of token data
        prompt = `You are SENTINEL AI, an expert DeFi analyst. For the user query "${query}", analyze the following data and provide a concise, insightful summary for a crypto investor.\n\n${summaryData}\n\nProvide a brief analysis covering key metrics, price trends, social sentiment, risks, and an overall verdict. Keep your response under 300 words and focus on actionable insights.`;
      } else {
        // General purpose AI prompt for when no specific data is found
        prompt = `You are SENTINEL AI, a super helpful and super knowledgeable assistant. The user's query is: "${query}". Provide a concise and helpful response.`;
      }
      
      // Stream AI response
      const aiResponse = await geminiService.streamTextContent(prompt, (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      });
      
      // Send completion status
      res.write(`data: ${JSON.stringify({ type: 'complete', summary: aiResponse })}\n\n`);
      
    } catch (error) {
      console.error('Error in AI streaming:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Unable to generate AI analysis at this time' })}\n\n`);
    }
    
    res.end();
    
  } catch (error) {
    console.error('Error setting up AI streaming:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
