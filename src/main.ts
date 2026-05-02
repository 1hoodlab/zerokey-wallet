import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  process.on('SIGTERM', () => {
    void app.close();
  });

  process.on('uncaughtException', (error) => {
    logger.fatal(error);
    process.exit(1);
  });

  process.on('unhandledRejection', (error) => {
    logger.fatal(error);
    process.exit(1);
  });
}

void bootstrap();
