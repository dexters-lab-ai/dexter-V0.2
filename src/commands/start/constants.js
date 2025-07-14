export const CANVAS_DIMENSIONS = {
  WIDTH: 800,
  HEIGHT: 1250
};

export const COLORS = {
  BACKGROUND: {
    START: '#2a0a0a',
    END: '#000000'
  },
  TEXT: {
    PRIMARY: '#ffffff',
    SECONDARY: '#b0b0b0',
    ACCENT: '#ff0066',
    SUCCESS: '#00FF00'
  },
  ROBOT: {
    BODY: '#FFD700',
    EYES: '#FF0000'
  }
};

export const FONTS = {
  TITLE: 'bold 42px "SF Toontime"',
  SUBTITLE: 'italic 20px "SF Toontime"',
  BODY: '24px "SF Toontime"',
  SMALL: '14px "SF Toontime"'
};

export const WELCOME_MESSAGES = {
  NEW_USER: `*Say "Hey to KATZ! [O.P.E.R.A.T.O.R-TG]" to bother him* 🐈‍⬛\n\n` +
           `*{username}*, ready for the trenches? 🌳🌍🕳️\n\n` +
           `_Intelligent & autonomous meme trading..._ 🤖💎\n\n` +
           `Need help? Type /help or /start over.`,
           
  RETURNING_USER: `*Welcome Back {username}!* 🐈‍⬛\n\n` +
                 `Ready for the trenches? 🌳🕳️\n\n` +
                 `_Let's find gems..._ 💎\n\n` +
                 `Need help? Type /help or /start over.`
};

export const REGISTRATION_PROMPT = {
  title: '*🆕 First Time?...*',
  message: `_Let's get you set up with your own secure wallets and access to all KATZ! [O.P.E.R.A.T.O.R-TG] features!_\n\n` +
          `• Secure wallet creation\n` +
          `• Multi-chain trenching\n` +
          `• AI-powered trading\n` +
          `• And much more...\n\n` +
          `Ready to start? 🚀`
};

export const CERTIFICATE_SETTINGS = {
  EXPIRY_TIME: 20000, // 20 seconds
  CONTAINER_PADDING: 20,
  LOGO_SIZE: 200,
  NETWORK_SPACING: 200,
  SIGNATURE_SETTINGS: {
    CLAW_SIZE: 8,
    SCRATCH_OFFSETS: [-20, -5, 10, 20]
  }
};