import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApplicationUser, UserClientAccess } from '@hmc/database';
import { JwtPayload, SYSTEM_ROLES } from '@hmc/shared';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(ApplicationUser)
    private userRepo: Repository<ApplicationUser>,
    @InjectRepository(UserClientAccess)
    private clientAccessRepo: Repository<UserClientAccess>
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'hmc_central_jwt_secret_dev_key_2026_super_secure_token',
    });
  }

  async validate(payload: any): Promise<JwtPayload> {
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account inactive or deleted');
    }

    const roles = user.roles.map((r) => r.name);
    const isSuperAdmin = roles.includes(SYSTEM_ROLES.SUPER_ADMIN);

    const permissionsSet = new Set<string>();
    user.roles.forEach((r) => {
      r.permissions?.forEach((p) => permissionsSet.add(p.code));
    });

    const clientAccesses = await this.clientAccessRepo.find({
      where: { userId: user.id },
    });
    const allowedClientIds = clientAccesses.map((a) => a.clientId);

    return {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles,
      permissions: Array.from(permissionsSet) as any,
      allowedClientIds,
      isSuperAdmin,
    };
  }
}
