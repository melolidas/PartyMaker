import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { HealthResponseDto } from './dto/health-response.dto';

type DatabaseNameRow = {
  database: string;
};

@Injectable()
export class HealthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponseDto> {
    try {
      const rows = await this.prisma.$queryRaw<DatabaseNameRow[]>`
        SELECT current_database() AS database
      `;
      const database = rows[0]?.database;

      if (!database) {
        throw new Error('PostgreSQL did not return the current database name');
      }

      return {
        status: 'ok',
        database: {
          status: 'connected',
          name: database,
        },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database connection is unavailable',
      });
    }
  }
}
