import { createCanvas, loadImage } from 'canvas';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Updated to standard horizontal certificate dimensions
const CANVAS_DIMENSIONS = {
  WIDTH: 2000,
  HEIGHT: 2200
};

export class CertificateGenerator {
  constructor() {
    this.canvas = createCanvas(CANVAS_DIMENSIONS.WIDTH, CANVAS_DIMENSIONS.HEIGHT);
    this.ctx = this.canvas.getContext('2d');
    this.font = '"Space Grotesk", sans-serif';
  }

  async generate(data) {
    await this.drawBackground();
    await this.drawHeader();
    await this.drawUserInfo(data.user);
    await this.drawAllWallets(data.wallets);
    await this.drawFooter();
    this.applySubtleMatrix();
    return this.canvas.toBuffer('image/png');
  }

  async drawBackground() {
    // Exact dark blue from your screenshot
    this.ctx.fillStyle = '#0e213a';
    this.ctx.fillRect(0, 0, CANVAS_DIMENSIONS.WIDTH, CANVAS_DIMENSIONS.HEIGHT);
    
    // Add binary matrix pattern like in your screenshot background
    this.drawMatrixBackground();
    
    // Add the glowing cyan border similar to your UI components
    this.drawGlowingBorder();
  }

  drawMatrixBackground() {
    this.ctx.font = '12px monospace';
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    
    for (let x = 0; x < CANVAS_DIMENSIONS.WIDTH; x += 20) {
      for (let y = 0; y < CANVAS_DIMENSIONS.HEIGHT; y += 20) {
        // Random binary digit
        if (Math.random() > 0.5) {
          const digit = Math.round(Math.random());
          this.ctx.fillText(digit.toString(), x, y);
        }
      }
    }
  }

  drawGlowingBorder() {
    const margin = 30;
    const width = CANVAS_DIMENSIONS.WIDTH - (margin * 2);
    const height = CANVAS_DIMENSIONS.HEIGHT - (margin * 2);
    const radius = 15;
    
    // Draw rounded rectangle border with cyan glow (like your UI cards)
    this.ctx.strokeStyle = '#00b8d4';
    this.ctx.lineWidth = 2;
    this.ctx.shadowColor = '#00b8d4';
    this.ctx.shadowBlur = 15;
    
    this.ctx.beginPath();
    this.ctx.moveTo(margin + radius, margin);
    this.ctx.lineTo(margin + width - radius, margin);
    this.ctx.arcTo(margin + width, margin, margin + width, margin + radius, radius);
    this.ctx.lineTo(margin + width, margin + height - radius);
    this.ctx.arcTo(margin + width, margin + height, margin + width - radius, margin + height, radius);
    this.ctx.lineTo(margin + radius, margin + height);
    this.ctx.arcTo(margin, margin + height, margin, margin + height - radius, radius);
    this.ctx.lineTo(margin, margin + radius);
    this.ctx.arcTo(margin, margin, margin + radius, margin, radius);
    this.ctx.closePath();
    this.ctx.stroke();
    
    // Reset shadow
    this.ctx.shadowBlur = 0;
  }

  async drawHeader() {
    const logoPath = path.resolve(__dirname, '../../../assets/images/logo.png');
    const logoBuffer = await loadImage(logoPath);
    
    // Draw logo with cyan glow effect (like your UI)
    this.ctx.save();
    
    // Add glow effect in cyan like your UI
    this.ctx.shadowColor = '#00b8d4';
    this.ctx.shadowBlur = 20;
    
    // Draw logo
    const logoSize = 140;
    const logoX = (CANVAS_DIMENSIONS.WIDTH / 2) - (logoSize / 2);
    const logoY = 80;
    this.ctx.drawImage(logoBuffer, logoX, logoY, logoSize, logoSize);
    this.ctx.restore();
    
    // Title with gradient text using your exact brand colors
    this.ctx.save();
    this.ctx.font = `bold 80px ${this.font}`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    
    // Draw text with custom gradient matching your site
    const textX = CANVAS_DIMENSIONS.WIDTH / 2;
    const textY = logoY + logoSize + 60;
    const gradientWidth = 280;
    
    const textGradient = this.ctx.createLinearGradient(
      textX - gradientWidth/2, textY - 30,
      textX + gradientWidth/2, textY + 30
    );
    textGradient.addColorStop(0, '#4caf50'); // Primary green
    textGradient.addColorStop(1, '#00b8d4'); // Cyan from your UI
    
    this.ctx.fillStyle = textGradient;
    this.ctx.fillText('D.A.I.L', textX, textY);
    
    // Add text shadow
    this.ctx.shadowColor = 'rgba(0, 184, 212, 0.5)';
    this.ctx.shadowBlur = 10;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;
    this.ctx.fillText('D.A.I.L', textX, textY);
    this.ctx.restore();
    
    // Add subtitle - moved lower as requested
    this.ctx.font = `normal 32px ${this.font}`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('WALLET CERTIFICATE', textX, textY + 80);
    
    // Add horizontal divider matching your UI styling
    this.addDivider(textY + 140);
  }

  addDivider(y, width = 1600) {
    const x = (CANVAS_DIMENSIONS.WIDTH - width) / 2;
    
    // Create a gradient stroke matching your UI
    const gradient = this.ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, 'rgba(0, 184, 212, 0)');
    gradient.addColorStop(0.1, 'rgba(0, 184, 212, 0.3)');
    gradient.addColorStop(0.5, 'rgba(0, 184, 212, 0.7)');
    gradient.addColorStop(0.9, 'rgba(0, 184, 212, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 184, 212, 0)');
    
    this.ctx.strokeStyle = gradient;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + width, y);
    this.ctx.stroke();
  }

  async drawUserInfo(user) {
    const y = 450;
    
    // Draw container with the exact style from your UI
    this.drawModernContainer(400, y, 1200, 140);
    
    // Draw user avatar placeholder with glowing green like your icons
    this.ctx.save();
    this.ctx.fillStyle = '#4caf50';
    const avatarSize = 80;
    const avatarX = 440;
    const avatarY = y + 30;
    
    // Glow effect matching your UI's green icons
    this.ctx.shadowColor = 'rgba(76, 175, 80, 0.6)';
    this.ctx.shadowBlur = 10;
    
    // Circle avatar
    this.ctx.beginPath();
    this.ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
    this.ctx.fill();
    
    // Add avatar icon
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.font = `bold 48px ${this.font}`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('@', avatarX + avatarSize/2, avatarY + avatarSize/2);
    this.ctx.restore();
    
    // Draw user info with your website's text styles
    this.ctx.font = `normal 24px ${this.font}`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('User ID:', 550, y + 60);
    
    this.ctx.font = `bold 24px ${this.font}`;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(user.telegramId || 'Not available', 650, y + 60);
    
    this.ctx.font = `normal 24px ${this.font}`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    this.ctx.fillText('Username:', 550, y + 100);
    
    this.ctx.font = `bold 24px ${this.font}`;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText('@' + (user.username || 'anonymous'), 670, y + 100);
  }

  drawModernContainer(x, y, width, height) {
    // Draw container matching your UI cards exactly
    this.ctx.save();
    
    // Dark semi-transparent background like your cards
    this.ctx.fillStyle = 'rgba(14, 33, 58, 0.8)';
    
    // Rounded rectangle with cyan glow (exactly like your UI cards)
    this.ctx.beginPath();
    const radius = 10;
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
    
    this.ctx.fill();
    
    // Add border with cyan glow like your UI
    this.ctx.strokeStyle = 'rgba(0, 184, 212, 0.7)';
    this.ctx.lineWidth = 1;
    this.ctx.shadowColor = 'rgba(0, 184, 212, 0.7)';
    this.ctx.shadowBlur = 8;
    this.ctx.stroke();
    
    this.ctx.restore();
  }

  async drawAllWallets(wallets) {
    // List of all networks to display
    const networks = [
      "sonic", "avalanche", "base", "bsc", "polygon", 
      "ethereum", "berachain", "linear", "arbitrum", "optimism", "solana"
    ];
    
    // Added more vertical spacing as requested
    const startY = 680;
    const walletHeight = 180;
    const spacing = 30;
    const columns = 2;
    const columnWidth = 900;
    const columnSpacing = 60;
    
    // Draw section title with your UI styling
    this.ctx.font = `bold 36px ${this.font}`;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('YOUR SECURE WALLETS', CANVAS_DIMENSIONS.WIDTH / 2, startY - 40);
    
    // Draw wallet cards exactly like your UI's network status cards
    networks.forEach((network, index) => {
      if (!wallets[network]) return;
      
      const column = index % columns;
      const row = Math.floor(index / columns);
      
      const x = 70 + (column * (columnWidth + columnSpacing));
      const y = startY + (row * (walletHeight + spacing));
      
      this.drawWalletCard(x, y, columnWidth, walletHeight, network, wallets[network]);
    });
  }

  drawWalletCard(x, y, width, height, network, wallet) {
    // Draw container matching your UI cards
    this.drawModernContainer(x, y, width, height);
    
    // Network indicator with green checkmark like your "Healthy" indicators
    this.ctx.save();
    this.ctx.fillStyle = '#4caf50';
    this.ctx.shadowColor = 'rgba(76, 175, 80, 0.6)';
    this.ctx.shadowBlur = 8;
    this.ctx.beginPath();
    this.ctx.arc(x + 25, y + 30, 10, 0, Math.PI * 2);
    this.ctx.fill();
    
    // Add checkmark
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x + 20, y + 30);
    this.ctx.lineTo(x + 25, y + 35);
    this.ctx.lineTo(x + 30, y + 25);
    this.ctx.stroke();
    this.ctx.restore();
    
    // Network name with capitalized first letter
    const networkName = network.charAt(0).toUpperCase() + network.slice(1);
    this.ctx.font = `bold 18px ${this.font}`;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(networkName, x + 45, y + 30);
    
    // Wallet address
    this.ctx.font = `normal 16px ${this.font}`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    
    // Truncate address for cleaner display
    const address = wallet.address;
    const truncatedAddress = address.substring(0, 8) + '...' + address.substring(address.length - 6);
    this.ctx.fillText(`Address: ${truncatedAddress}`, x + 45, y + 60);
    
    // Private/Public key (based on network type)
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    let keyType, keyValue;
    
    if (network === 'solana' || network === 'avalanche') {
      keyType = 'Private Key:';
      keyValue = wallet.privateKey;
    } else {
      keyType = 'Public Key:';
      keyValue = wallet.publicKey;
    }
    
    // Implement text wrapping for the key
    const maxWidth = width - 60;
    const lineHeight = 24;
    let keyY = y + 90;
    
    // Draw the key type (label)
    this.ctx.fillText(keyType, x + 45, keyY);
    
    // Calculate the width of the key type text to determine the starting point for the key value
    const keyTypeWidth = this.ctx.measureText(keyType).width;
    const startX = x + 45 + keyTypeWidth + 5; // Add a small space after the label
    
    // Wrap and draw the key value
    this.wrapText(this.ctx, keyValue, startX, keyY, maxWidth, lineHeight);
    
    // Update keyY to account for possible multiple lines from the wrapped key
    // Assuming the key might take up to 2 lines (adjust as needed)
    keyY += (network === 'solana' || network === 'avalanche' ? lineHeight * 2 : lineHeight);
    
    // Add mnemonic if available
    if (wallet.mnemonic) {
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      const mnemonicPhrase = typeof wallet.mnemonic === 'string' ? 
        wallet.mnemonic : 
        (wallet.mnemonic.phrase || 'N/A');
        
      // Format mnemonic to fit in two lines if needed
      const words = mnemonicPhrase.split(' ');
      const firstLine = words.slice(0, 6).join(' ');
      const secondLine = words.slice(6).join(' ');
      
      this.ctx.fillText(`Mnemonic: ${firstLine}`, x + 45, keyY + 30);
      if (secondLine) {
        this.ctx.fillText(`${secondLine}`, x + 125, keyY + 60);
      }
    }
}

// Add this helper method to your class
wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    // First determine if text needs wrapping
    const textWidth = ctx.measureText(text).width;
    
    if (textWidth <= maxWidth) {
        // Text fits in one line
        ctx.fillText(text, x, y);
        return 1; // Return line count
    } else {
        // Determine a good breaking point
        let breakPoint = Math.floor(text.length * (maxWidth / textWidth));
        
        // Ensure we don't break in the middle of a character (particularly important for hex strings)
        if (breakPoint > 0 && breakPoint < text.length) {
            // For crypto keys, breaking at character level is fine
            ctx.fillText(text.substring(0, breakPoint), x, y);
            
            // Move to the beginning of next line (align with label indent)
            const labelIndent = x - 5 - ctx.measureText("Private Key:").width; // Adjustable
            ctx.fillText(text.substring(breakPoint), labelIndent, y + lineHeight);
            
            return 2; // Return line count
        } else {
            // Text fits in one line after all
            ctx.fillText(text, x, y);
            return 1;
        }
    }
  }

  async drawFooter() {
    const y = CANVAS_DIMENSIONS.HEIGHT - 180;
    
    // Add divider with cyan glow like your UI
    this.addDivider(y);
    
    // Add timestamp
    const now = new Date();
    const options = {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    const timestamp = now.toLocaleString('en-US', options);
    
    this.ctx.font = `normal 18px ${this.font}`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`Generated on ${timestamp}`, CANVAS_DIMENSIONS.WIDTH / 2, y + 40);
    
    // Security notice with the green accent color from your UI
    this.ctx.font = `bold 18px ${this.font}`;
    this.ctx.fillStyle = '#4caf50';
    this.ctx.fillText('IMPORTANT: Keep your wallet credentials secure!', CANVAS_DIMENSIONS.WIDTH / 2, y + 80);
    
    this.ctx.font = `normal 16px ${this.font}`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    this.ctx.fillText('This certificate will self-destruct in 60 seconds.', CANVAS_DIMENSIONS.WIDTH / 2, y + 110);
  }

  applySubtleMatrix() {
    // Add binary matrix effect overlay like your website background
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    this.ctx.font = '10px monospace';
    
    for (let x = 0; x < CANVAS_DIMENSIONS.WIDTH; x += 15) {
      for (let y = 0; y < CANVAS_DIMENSIONS.HEIGHT; y += 15) {
        if (Math.random() > 0.85) {
          const binary = Math.round(Math.random());
          this.ctx.fillText(binary.toString(), x, y);
        }
      }
    }
    
    // Add a very subtle vignette effect
    const gradient = this.ctx.createRadialGradient(
      CANVAS_DIMENSIONS.WIDTH / 2, CANVAS_DIMENSIONS.HEIGHT / 2, CANVAS_DIMENSIONS.HEIGHT / 3,
      CANVAS_DIMENSIONS.WIDTH / 2, CANVAS_DIMENSIONS.HEIGHT / 2, CANVAS_DIMENSIONS.HEIGHT
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, CANVAS_DIMENSIONS.WIDTH, CANVAS_DIMENSIONS.HEIGHT);
  }
}