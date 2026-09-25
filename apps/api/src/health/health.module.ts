import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [MediaModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class HealthModule {}
