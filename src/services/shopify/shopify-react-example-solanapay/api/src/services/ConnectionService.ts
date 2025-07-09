import { Connection } from "@solana/web3.js";
import { Singleton } from "typescript-ioc";

@Singleton
export class ConnectionService {
  readonly connection: Connection;

  constructor() {
    const protocol = process.env.API_PROTOCOL || 'http';
    const host = process.env.API_HOST || 'localhost';
    const port = process.env.API_PORT || '8899';
    const endpoint = process.env.API_ENDPOINT || `${protocol}://${host}:${port}`;
    
    this.connection = new Connection(
      endpoint,
      {
        commitment: 'confirmed',
        httpHeaders: process.env.API_HEADERS ? JSON.parse(process.env.API_HEADERS) : undefined
      }
    );
    
    console.log(`🔗 Connected to Solana endpoint: ${endpoint}`);
  }
}
