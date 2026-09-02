import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import {
  ApplicationUser,
  ApplicationLoginHistory,
  UserClientAccess,
} from '@hmc/database';
import {
  LoginRequestDto,
  RefreshTokenRequestDto,
  ChangePasswordRequestDto,
  AdminResetPasswordRequestDto,
  LoginResult,
  JwtPayload,
  SYSTEM_ROLES,
} from '@hmc/shared';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly MAX_FAILED_ATTEMPTS = parseInt(
    process.env.MAX_FAILED_LOGIN_ATTEMPTS || '5',
    10
  );
  private readonly LOCKOUT_DURATION_MINUTES = parseInt(
    process.env.LOCKOUT_DURATION_MINUTES || '15',
    10
  );

  constructor(
    @InjectRepository(ApplicationUser)
    private userRepo: Repository<ApplicationUser>,
    @InjectRepository(ApplicationLoginHistory)
    private loginHistoryRepo: Repository<ApplicationLoginHistory>,
    @InjectRepository(UserClientAccess)
    private clientAccessRepo: Repository<UserClientAccess>,
    private jwtService: JwtService
  ) {}

  async login(
    dto: LoginRequestDto,
    ipAddress?: string,
    userAgent?: string
  ): Promise<LoginResult> {
    const user = await this.userRepo.findOne({
      where: [{ username: dto.username }, { email: dto.username }],
      relations: ['roles', 'roles.permissions'],
    });

    // Explicit disable check
    if (user && (user.isDisabled || user.status === 'DISABLED')) {
      await this.recordLoginHistory(user.id, 'FAILED_CREDENTIALS', 'Account is disabled', ipAddress, userAgent);
      throw new UnauthorizedException('Account has been explicitly disabled. Contact security administrator.');
    }

    // Check account lockout
    if (user && user.lockoutUntil && new Date() < new Date(user.lockoutUntil)) {
      await this.recordLoginHistory(user.id, 'LOCKED_OUT', 'Account locked out', ipAddress, userAgent);
      const remainingMinutes = Math.ceil(
        (new Date(user.lockoutUntil).getTime() - Date.now()) / (1000 * 60)
      );
      throw new UnauthorizedException(
        `Account is locked due to multiple failed login attempts. Try again in ${remainingMinutes} minute(s).`
      );
    }

    // Verify user exists and status is ACTIVE
    if (!user || user.status !== 'ACTIVE') {
      if (user) {
        await this.recordLoginHistory(user.id, 'FAILED_CREDENTIALS', 'User inactive or locked', ipAddress, userAgent);
      }
      throw new UnauthorizedException('Invalid username or password');
    }

    // Verify password with Argon2id
    const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      user.failedAttempts += 1;
      if (user.failedAttempts >= this.MAX_FAILED_ATTEMPTS) {
        const lockoutDate = new Date();
        lockoutDate.setMinutes(lockoutDate.getMinutes() + this.LOCKOUT_DURATION_MINUTES);
        user.lockoutUntil = lockoutDate;
        user.status = 'LOCKED';
      }
      await this.userRepo.save(user);
      await this.recordLoginHistory(user.id, 'FAILED_CREDENTIALS', 'Invalid password', ipAddress, userAgent);

      const attemptsRemaining = this.MAX_FAILED_ATTEMPTS - user.failedAttempts;
      if (attemptsRemaining > 0) {
        throw new UnauthorizedException(
          `Invalid username or password. ${attemptsRemaining} attempt(s) remaining before lockout.`
        );
      } else {
        throw new UnauthorizedException(
          `Account locked for ${this.LOCKOUT_DURATION_MINUTES} minutes due to multiple failed attempts.`
        );
      }
    }

    // Reset failed attempts upon successful login
    user.failedAttempts = 0;
    user.lockoutUntil = null;
    user.lastLoginAt = new Date();

    const clientAccesses = await this.clientAccessRepo.find({
      where: { userId: user.id },
    });
    const allowedClientIds = clientAccesses.map((a) => a.clientId);

    const roles = user.roles.map((r) => r.name);
    const isSuperAdmin = roles.includes(SYSTEM_ROLES.SUPER_ADMIN);

    const permissionsSet = new Set<string>();
    user.roles.forEach((r) => {
      r.permissions?.forEach((p) => permissionsSet.add(p.code));
    });

    const jwtPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles,
      permissions: Array.from(permissionsSet) as any,
      allowedClientIds,
      isSuperAdmin,
    };

    const accessToken = this.jwtService.sign(jwtPayload, {
      secret: process.env.JWT_SECRET || 'hmc_central_jwt_secret_dev_key_2026_super_secure_token',
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id, type: 'refresh' },
      {
        secret: process.env.JWT_REFRESH_SECRET || 'hmc_central_refresh_secret_dev_key_2026_super_secure_token',
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      }
    );

    user.refreshTokenHash = await argon2.hash(refreshToken);
    await this.userRepo.save(user);

    await this.recordLoginHistory(user.id, 'SUCCESS', null, ipAddress, userAgent);

    return {
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900, // 15 mins
      },
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        failedAttempts: user.failedAttempts,
        lockoutUntil: user.lockoutUntil ? new Date(user.lockoutUntil).toISOString() : null,
        lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        roles: user.roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description || '',
          isSystem: r.isSystem,
          permissions: r.permissions?.map((p) => p.code as any) || [],
        })),
        assignedClientIds: allowedClientIds,
      },
    };
  }

  async refreshToken(dto: RefreshTokenRequestDto): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    try {
      const decoded: any = this.jwtService.verify(dto.refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'hmc_central_refresh_secret_dev_key_2026_super_secure_token',
      });

      const user = await this.userRepo.findOne({
        where: { id: decoded.sub },
        relations: ['roles', 'roles.permissions'],
      });

      if (!user || user.isDisabled || user.status !== 'ACTIVE' || !user.refreshTokenHash) {
        throw new UnauthorizedException('Invalid, disabled, or revoked refresh token');
      }

      const isValid = await argon2.verify(user.refreshTokenHash, dto.refreshToken);
      if (!isValid) {
        throw new UnauthorizedException('Refresh token mismatch');
      }

      const clientAccesses = await this.clientAccessRepo.find({
        where: { userId: user.id },
      });
      const allowedClientIds = clientAccesses.map((a) => a.clientId);

      const roles = user.roles.map((r) => r.name);
      const isSuperAdmin = roles.includes(SYSTEM_ROLES.SUPER_ADMIN);
      const permissionsSet = new Set<string>();
      user.roles.forEach((r) => {
        r.permissions?.forEach((p) => permissionsSet.add(p.code));
      });

      const jwtPayload: JwtPayload = {
        sub: user.id,
        username: user.username,
        email: user.email,
        roles,
        permissions: Array.from(permissionsSet) as any,
        allowedClientIds,
        isSuperAdmin,
      };

      const newAccessToken = this.jwtService.sign(jwtPayload, {
        secret: process.env.JWT_SECRET || 'hmc_central_jwt_secret_dev_key_2026_super_secure_token',
        expiresIn: '15m',
      });

      const newRefreshToken = this.jwtService.sign(
        { sub: user.id, type: 'refresh' },
        {
          secret: process.env.JWT_REFRESH_SECRET || 'hmc_central_refresh_secret_dev_key_2026_super_secure_token',
          expiresIn: '7d',
        }
      );

      user.refreshTokenHash = await argon2.hash(newRefreshToken);
      await this.userRepo.save(user);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.userRepo.update(userId, { refreshTokenHash: null });
  }

  async changePassword(userId: string, dto: ChangePasswordRequestDto): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || user.isDisabled) throw new BadRequestException('User not found or disabled');

    const isCurrentValid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!isCurrentValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    user.requirePasswordChange = false;
    user.refreshTokenHash = null; // Invalidate all active refresh sessions
    await this.userRepo.save(user);
  }

  async adminResetPassword(dto: AdminResetPasswordRequestDto, adminUsername: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (!user) throw new BadRequestException('User not found');

    user.passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    user.requirePasswordChange = dto.requirePasswordChangeOnLogin;
    user.failedAttempts = 0;
    user.lockoutUntil = null;
    user.refreshTokenHash = null;
    user.updatedBy = adminUsername;
    // If account was disabled, adminResetPassword does NOT automatically re-enable without explicit intent
    await this.userRepo.save(user);
  }

  private async recordLoginHistory(
    userId: string,
    status: 'SUCCESS' | 'FAILED_CREDENTIALS' | 'LOCKED_OUT',
    failureReason: string | null,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      const history = this.loginHistoryRepo.create({
        userId,
        status,
        failureReason,
        ipAddress: ipAddress || '127.0.0.1',
        userAgent: userAgent || 'Unknown Client',
      });
      await this.loginHistoryRepo.save(history);
    } catch (err) {
      this.logger.error('Failed to record login history', err);
    }
  }
}
