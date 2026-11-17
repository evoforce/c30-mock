import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ResourceService } from './resource.service';
import { ResourceType } from '@c30/shared';

const RESOURCE_TYPES: ResourceType[] = ['COURSEWARE', 'MICROCOURSE', 'BOARD'];

function parseType(value: unknown): ResourceType {
  if (typeof value === 'string' && RESOURCE_TYPES.includes(value as ResourceType)) {
    return value as ResourceType;
  }
  throw new BadRequestException('无效的资源类型');
}

@Controller('resource')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Get()
  async list(@Query('type') type?: ResourceType) {
    const items = await this.resourceService.list(type);
    return { items, total: items.length };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('type') type: ResourceType,
    @Query('ownerId') ownerId = 'u-teacher-1',
  ) {
    return this.resourceService.save(file, parseType(type), ownerId);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.resourceService.findOne(id);
  }

  @Get(':id/file')
  async file(@Param('id') id: string, @Res() res: Response) {
    const f = await this.resourceService.readFile(id);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.send(f.buffer);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.resourceService.remove(id);
    return { ok: true };
  }
}
