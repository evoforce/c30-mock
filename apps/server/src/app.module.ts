import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { ResourceModule } from './modules/resource/resource.module';
import { SessionModule } from './modules/session/session.module';
import { WhiteboardModule } from './modules/whiteboard/whiteboard.module';
import { FileModule } from './modules/file/file.module';
import { EventModule } from './modules/event/event.module';

@Module({
  controllers: [HealthController],
  imports: [
    PrismaModule,
    AuthModule,
    UserModule,
    ResourceModule,
    SessionModule,
    WhiteboardModule,
    FileModule,
    EventModule,
  ],
})
export class AppModule {}
