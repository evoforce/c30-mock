import { Injectable, NotFoundException } from '@nestjs/common';
import { Resource, ResourceType } from '@c30/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../file/minio.service';
import { randomUUID } from 'crypto';

@Injectable()
export class ResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async list(type?: ResourceType): Promise<Resource[]> {
    const rows = await this.prisma.resource.findMany({
      where: type ? { type: type as any } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      type: r.type as ResourceType,
      title: r.title,
      fileKey: r.fileKey,
      fileSize: r.fileSize,
      mimeType: r.mimeType,
      pageCount: r.pageCount ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async save(file: Express.Multer.File, type: ResourceType, ownerId: string): Promise<Resource> {
    const id = randomUUID();
    const ext = file.originalname.split('.').pop() || 'bin';
    const fileKey = `${type.toLowerCase()}/${id}.${ext}`;

    // 上传到 MinIO
    await this.minio.putObject(fileKey, file.buffer, file.size, file.mimetype);

    const row = await this.prisma.resource.create({
      data: {
        id,
        ownerId,
        type: type as any,
        title: file.originalname,
        fileKey,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    });

    return {
      id: row.id,
      ownerId: row.ownerId,
      type: row.type as ResourceType,
      title: row.title,
      fileKey: row.fileKey,
      fileSize: row.fileSize,
      mimeType: row.mimeType,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async findOne(id: string): Promise<Resource> {
    const r = await this.prisma.resource.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('资源不存在');
    return {
      id: r.id,
      ownerId: r.ownerId,
      type: r.type as ResourceType,
      title: r.title,
      fileKey: r.fileKey,
      fileSize: r.fileSize,
      mimeType: r.mimeType,
      pageCount: r.pageCount ?? undefined,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async remove(id: string): Promise<void> {
    const r = await this.findOne(id);
    await this.minio.removeObject(r.fileKey);
    await this.prisma.resource.delete({ where: { id } });
  }

  async readFile(id: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    const r = await this.findOne(id);
    const buffer = await this.minio.getObject(r.fileKey);
    return { buffer, mimeType: r.mimeType, name: r.title };
  }
}
