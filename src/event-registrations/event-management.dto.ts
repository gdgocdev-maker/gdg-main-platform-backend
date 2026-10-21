import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EventStatus, QuestionType } from '../generated/prisma/client.js';

export class EventQuestionDto {
  @IsString()
  @MaxLength(2000)
  questionText: string;

  @IsEnum(QuestionType)
  questionType: QuestionType;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  options?: string[] | null;
}

export class EventQuestionUpdateDto extends EventQuestionDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  questionId?: number;
}

export class CreateEventDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsISO8601()
  startsAt: string;

  @IsISO8601()
  endsAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string | null;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsISO8601()
  registrationDeadline: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  confirmationWindowHours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  requirements?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(Object.values(EventStatus))
  status?: EventStatus;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EventQuestionDto)
  questions?: EventQuestionDto[];
}

export class UpdateEventDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601()
  startsAt?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  capacity?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601()
  registrationDeadline?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  confirmationWindowHours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  requirements?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(Object.values(EventStatus))
  status?: EventStatus;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EventQuestionUpdateDto)
  questions?: EventQuestionUpdateDto[];
}
