import { IsEmail, Matches, MaxLength } from 'class-validator';

export class VerifySignupEmailDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @Matches(/^\d{6}$/)
  token: string;
}
