import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttp } from './configure-http.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
configureHttp(app);
await app.listen(process.env.PORT ?? 3001);
