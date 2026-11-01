import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateIf } from 'class-validator';

export const ANNOUNCEMENT_CATEGORIES = ['events', 'recruitment', 'workshops', 'results', 'community', 'trip'] as const;
export const ANNOUNCEMENT_STATUSES = ['DRAFT', 'PUBLISHED'] as const;

export class CreateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @IsIn(ANNOUNCEMENT_CATEGORIES)
  category: (typeof ANNOUNCEMENT_CATEGORIES)[number];

  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES)
  status?: (typeof ANNOUNCEMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  body?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  actionLabel?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  actionHref?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class UpdateAnnouncementDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  title?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(ANNOUNCEMENT_CATEGORIES)
  category?: (typeof ANNOUNCEMENT_CATEGORIES)[number];

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(ANNOUNCEMENT_STATUSES)
  status?: (typeof ANNOUNCEMENT_STATUSES)[number];

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  body?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionLabel?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  actionHref?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  pinned?: boolean;
}
