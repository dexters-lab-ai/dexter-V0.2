import { config } from '../../core/config.js';
import axios from 'axios';

async function generateStorefrontToken() {
  const shopDomain = 'katz-store-cn-merch.myshopify.com';
  const adminApiKey = '650a3ac02550c39d1fc9047810767c68';

  try {
    console.log('🔄 Generating Storefront Access Token...');
    
    const response = await axios({
      url: `https://${shopDomain}/admin/api/2024-01/storefront_access_tokens.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': adminApiKey
      },
      data: {
        storefront_access_token: {
          title: 'KATZ AI Bot Token'
        }
      }
    });

    const { storefront_access_token } = response.data;
    
    console.log('✅ Storefront Access Token Generated:');
    console.log('Title:', storefront_access_token.title);
    console.log('Access Token:', storefront_access_token.access_token);
    
    return storefront_access_token.access_token;
  } catch (error) {
    console.error('❌ Error generating token:', error.response?.data || error.message);
    throw error;
  }
}

// Run the generator
generateStorefrontToken().catch(console.error);