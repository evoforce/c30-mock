import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { CoursewareModule } from './modules/courseware/courseware.module';
import { SessionModule } from './modules/session/session.module';
import { WhiteboardModule } from './modules/whiteboard/whiteboard.module';
import { FileModule } from './modules/file/file.module';
import { EventModule } from './modules/event/event.module';

@Module({
  controllers: [HealthController],
  imports: [
    AuthModule,
    UserModule,
    CoursewareModule,
    SessionModule,
    WhiteboardModule,
    FileModule,
    EventModule,
  ],
})
export class AppModule {}
