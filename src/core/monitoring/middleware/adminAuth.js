import basicAuth from 'basic-auth';
import { config } from '../../config'; 

export function adminAuth(req, res, next) {
  // Optionally restrict by IP so only local requests are allowed
  const clientIp = req.connection.remoteAddress || req.socket.remoteAddress;
  if (clientIp && !clientIp.startsWith('127.0.0.1') && clientIp !== '::1') {
    return res.status(403).json({ error: 'Access restricted to local requests only.' });
  }

  const user = basicAuth(req);
  if (!user || user.name !== config.ADMIN_USERNAME || user.pass !== config.ADMIN_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
