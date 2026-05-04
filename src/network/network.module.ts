import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NetworkRegistryService } from './network-registry.service';

@Module({
  imports: [DatabaseModule],
  providers: [NetworkRegistryService],
  exports: [NetworkRegistryService],
})
export class NetworkModule {}
