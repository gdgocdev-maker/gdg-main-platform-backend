import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const REQUESTED_ROLES = ['Leader', 'Co-Leader', 'Advisor', 'Member'] as const;

export class MembershipApplicationDataDto {
  @IsString()
  @MaxLength(50)
  phoneNumber: string;

  @IsEmail()
  @MaxLength(255)
  universityEmail: string;

  @IsString()
  @MaxLength(255)
  university: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  branch?: string;

  @IsString()
  @MaxLength(255)
  college: string;

  @IsString()
  @MaxLength(255)
  major: string;

  @IsString()
  @MaxLength(30)
  level: string;

  @IsIn(['female', 'male'])
  gender: string;
}

export class MembershipCommitteeApplicationDto {
  @Matches(/^[A-Z0-9_]{1,20}$/)
  committeeCode: string;

  // This is stored as the applicant's preference only. Approval always grants
  // the least-privileged Member position.
  @IsIn(REQUESTED_ROLES)
  requestedRole: (typeof REQUESTED_ROLES)[number];
}

export class CreateMembershipRequestDto {
  @ValidateNested()
  @Type(() => MembershipApplicationDataDto)
  applicationData: MembershipApplicationDataDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((committee: MembershipCommitteeApplicationDto) => committee.committeeCode)
  @ValidateNested({ each: true })
  @Type(() => MembershipCommitteeApplicationDto)
  committees: MembershipCommitteeApplicationDto[];
}

export class DecideMembershipRequestDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';
}

export class MembershipRequestCommitteeParamDto {
  @IsString()
  @Matches(/^\d+$/)
  requestId: string;

  @Matches(/^[A-Z0-9_]{1,20}$/)
  committeeCode: string;
}

export class ListMembershipRequestsQueryDto {
  @Matches(/^[A-Z0-9_]{1,20}$/)
  committeeCode: string;
}
