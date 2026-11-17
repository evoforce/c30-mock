import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private client: Client;
  private bucket: string;

  constructor() {
    this.client = new Client({
      endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'c30minio',
      secretKey: process.env.MINIO_SECRET_KEY || 'c30miniopassword',
    });
    this.bucket = process.env.MINIO_BUCKET || 'courseware';
  }

  async onModuleInit() {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async putObject(key: string, buffer: Buffer, size: number, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, size, {
      'Content-Type': contentType,
    });
  }

  async getObject(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }
}
