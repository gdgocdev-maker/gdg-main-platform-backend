import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  refreshToken: string;
}
