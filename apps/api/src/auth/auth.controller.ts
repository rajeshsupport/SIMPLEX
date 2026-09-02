import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/user.decorator.js';
import {
  LoginRequestSchema,
  LoginRequestDto,
  RefreshTokenRequestSchema,
  RefreshTokenRequestDto,
  ChangePasswordRequestSchema,
  ChangePasswordRequestDto,
  AdminResetPasswordRequestSchema,
  AdminResetPasswordRequestDto,
  JwtPayload,
  PERMISSIONS,
} from '@hmc/shared';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) dto: LoginRequestDto,
    @Req() req: Request
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.login(dto, ipAddress, userAgent);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Body(new ZodValidationPipe(RefreshTokenRequestSchema)) dto: RefreshTokenRequestDto
  ) {
    return this.authService.refreshToken(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser('sub') userId: string) {
    await this.authService.logout(userId);
    return { success: true, message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@CurrentUser() user: JwtPayload) {
    return { user };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('sub') userId: string,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema)) dto: ChangePasswordRequestDto
  ) {
    await this.authService.changePassword(userId, dto);
    return { success: true, message: 'Password changed successfully' };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.APPLICATION_USER_MANAGE)
  @Post('admin-reset-password')
  @HttpCode(HttpStatus.OK)
  async adminResetPassword(
    @CurrentUser('username') adminUsername: string,
    @Body(new ZodValidationPipe(AdminResetPasswordRequestSchema)) dto: AdminResetPasswordRequestDto
  ) {
    await this.authService.adminResetPassword(dto, adminUsername);
    return { success: true, message: 'Password reset successfully' };
  }
}
