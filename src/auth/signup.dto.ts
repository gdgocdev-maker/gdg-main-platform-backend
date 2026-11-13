import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SignupApplicationDataDto {
  @IsString() @MaxLength(50) phoneNumber: string;
  @IsOptional() @IsEmail() @MaxLength(255) universityEmail?: string;
  @IsString() @MaxLength(255) university: string;
  @IsOptional() @IsString() @MaxLength(100)
  @Matches(/^[^\u0000-\u001F\u007F-\u009F]*\S[^\u0000-\u001F\u007F-\u009F]*$/)
  branch?: string;
  @IsString() @MaxLength(255) college: string;
  @IsString() @MaxLength(255) major: string;
  @IsString() @MaxLength(30) level: string;
  @IsIn(['female', 'male']) gender: string;
  @IsOptional() @IsObject() skillsByCommittee?: Record<string, string[]>;
}

class SignupCommitteeDto {
  @Matches(/^[A-Z0-9_]{1,20}$/) committeeCode: string;
  @IsIn(['Leader', 'Co-Leader', 'Advisor', 'Member']) requestedRole: string;
}

export class SignupDto {
  @IsOptional() @IsIn(['en', 'ar']) locale?: 'en' | 'ar';

  @IsString({ message: 'fullName must be text.' })
  @Matches(/\S/, { message: 'fullName is required.' })
  @MaxLength(255, { message: 'fullName must be at most 255 characters.' })
  fullName: string;

  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(255, { message: 'email must be at most 255 characters.' })
  email: string;

  @IsOptional()
  @IsEmail({}, { message: 'universityEmail must be a valid email address.' })
  @MaxLength(255)
  universityEmail?: string;

  @IsString({ message: 'password must be text.' })
  @MinLength(8, { message: 'password must be at least 8 characters.' })
  @MaxLength(72, { message: 'password must be at most 72 characters.' })
  password: string;

  @IsIn(['MEMBER', 'NON_MEMBER'])
  registrationType: 'MEMBER' | 'NON_MEMBER';

  @ValidateNested()
  @Type(() => SignupApplicationDataDto)
  applicationData: SignupApplicationDataDto;

  @IsOptional()
  @IsArray()
  @ArrayUnique((committee: SignupCommitteeDto) => committee.committeeCode)
  @ValidateNested({ each: true })
  @Type(() => SignupCommitteeDto)
  committees?: SignupCommitteeDto[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(['ADVISOR', 'DEVELOPER_COMMITTEES_LEADER'], { each: true })
  requestedGlobalRoles?: string[];
}
