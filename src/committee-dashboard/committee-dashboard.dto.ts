import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum CommitteeTaskPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum CommitteeTaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  // Done by the member, waiting for a committee leader to confirm.
  PENDING_REVIEW = 'PENDING_REVIEW',
  COMPLETED = 'COMPLETED',
}

/** Statuses a member may set on their own task; only a leader can make it COMPLETED. */
export const MEMBER_TASK_STATUSES = [CommitteeTaskStatus.TODO, CommitteeTaskStatus.IN_PROGRESS, CommitteeTaskStatus.PENDING_REVIEW] as const;

export class UpdateMyTaskDto {
  @IsIn(MEMBER_TASK_STATUSES)
  status!: (typeof MEMBER_TASK_STATUSES)[number];
}

export class ReviewCommitteeTaskDto {
  @IsIn(['APPROVE', 'RETURN'])
  decision!: 'APPROVE' | 'RETURN';
}

export class CreateCommitteeMemberDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class AssignDeveloperCommitteeMemberDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  committeeCode!: string;

  @IsIn(['Member', 'Leader', 'Co-Leader'])
  role!: 'Member' | 'Leader' | 'Co-Leader';
}

export class AssignClubPersonDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(['Member', 'Leader', 'Co-Leader', 'ADVISOR', 'DEVELOPER_COMMITTEES_LEADER'])
  role!: 'Member' | 'Leader' | 'Co-Leader' | 'ADVISOR' | 'DEVELOPER_COMMITTEES_LEADER';

  @IsOptional()
  @IsString()
  @MaxLength(20)
  committeeCode?: string;
}

export class RemoveClubPersonDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  committeeCode?: string;
}

export class AddMemberToCommitteeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  committeeCode!: string;
}

export class CreateCommitteeTaskDto {
  @IsString()
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsInt()
  @Min(1)
  assignedMemberId!: number;

  @IsDateString()
  dueAt!: string;

  @IsEnum(CommitteeTaskPriority)
  priority!: CommitteeTaskPriority;

  @IsOptional()
  @IsEnum(CommitteeTaskStatus)
  status?: CommitteeTaskStatus;
}

export class UpdateCommitteeTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  assignedMemberId?: number;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsEnum(CommitteeTaskPriority)
  priority?: CommitteeTaskPriority;

  @IsOptional()
  @IsEnum(CommitteeTaskStatus)
  status?: CommitteeTaskStatus;
}

export class CreateLeadershipTaskDto {
  @IsString()
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsInt()
  @Min(1)
  assignedMemberId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  targetCommitteeCode!: string;

  @IsDateString()
  dueAt!: string;

  @IsEnum(CommitteeTaskPriority)
  priority!: CommitteeTaskPriority;
}

export class UpdateLeadershipTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  assignedMemberId?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  targetCommitteeCode?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsEnum(CommitteeTaskPriority)
  priority?: CommitteeTaskPriority;

  @IsOptional()
  @IsEnum(CommitteeTaskStatus)
  status?: CommitteeTaskStatus;
}
export class UpdateCommitteePointsDto {
  @IsInt()
  pointsDelta!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class UpdateGlobalPointsDto extends UpdateCommitteePointsDto {
  @IsOptional()
  @IsIn(['ADVISOR', 'DEVELOPER_COMMITTEES_LEADER'])
  globalRoleCode?: 'ADVISOR' | 'DEVELOPER_COMMITTEES_LEADER';
}

export const EVENT_TYPES = ['Workshop', 'Conference', 'Talk', 'Panel', 'Hackathon', 'Trip'] as const;
export const REGISTRANT_FIELDS = ['fullName', 'college', 'major', 'phone', 'email', 'membership'] as const;
export const EVENT_QUESTION_TYPES = ['TEXT', 'SELECT', 'RADIO', 'CHECKBOX'] as const;

export class CreateEventQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text!: string;

  @IsIn(EVENT_QUESTION_TYPES)
  type!: (typeof EVENT_QUESTION_TYPES)[number];

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];
}

export class CreateCommitteeEventDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @IsIn(EVENT_TYPES)
  eventType!: (typeof EVENT_TYPES)[number];

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsDateString()
  registrationDeadline!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  location!: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  mapsLink?: string;

  @IsInt()
  @Min(1)
  @Max(5000)
  capacity!: number;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  speakers?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  requirements?: string;

  @IsOptional()
  @IsArray()
  @IsIn(REGISTRANT_FIELDS, { each: true })
  requiredRegistrantFields?: (typeof REGISTRANT_FIELDS)[number][];

  @IsIn(['PUBLISHED', 'DRAFT'])
  status!: 'PUBLISHED' | 'DRAFT';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateEventQuestionDto)
  questions?: CreateEventQuestionDto[];
}

/** Editable event details. Publishing state and registration questions are managed separately. */
export class UpdateCommitteeEventDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(EVENT_TYPES)
  eventType?: (typeof EVENT_TYPES)[number];

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  startsAt?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  endsAt?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  registrationDeadline?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  capacity?: number;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  mapsLink?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(2000)
  speakers?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(5000)
  requirements?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  imageUrl?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateEventQuestionDto)
  questions?: CreateEventQuestionDto[];
}
