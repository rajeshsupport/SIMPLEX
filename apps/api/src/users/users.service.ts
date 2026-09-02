import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as argon2 from 'argon2';
import {
  ApplicationUser,
  Role,
  Client,
  UserClientAccess,
} from '@hmc/database';
import {
  CreateUserRequestDto,
  UpdateUserRequestDto,
  UserSummary,
} from '@hmc/shared';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(ApplicationUser)
    private userRepo: Repository<ApplicationUser>,
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
    @InjectRepository(Client)
    private clientRepo: Repository<Client>,
    @InjectRepository(UserClientAccess)
    private clientAccessRepo: Repository<UserClientAccess>
  ) {}

  async getAllUsers(): Promise<UserSummary[]> {
    const users = await this.userRepo.find({
      relations: ['roles', 'roles.permissions', 'clientAccesses'],
      order: { createdAt: 'DESC' },
    });

    return users.map((u) => this.mapToSummary(u));
  }

  async getUserById(id: string): Promise<UserSummary> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: ['roles', 'roles.permissions', 'clientAccesses'],
    });
    if (!user) throw new NotFoundException('User not found');
    return this.mapToSummary(user);
  }

  async createUser(dto: CreateUserRequestDto, creatorUsername: string): Promise<UserSummary> {
    const existing = await this.userRepo.findOne({
      where: [{ username: dto.username }, { email: dto.email }],
    });
    if (existing) {
      throw new BadRequestException('Username or email already exists');
    }

    const roles = await this.roleRepo.find({
      where: { id: In(dto.roleIds) },
      relations: ['permissions'],
    });
    if (roles.length === 0) {
      throw new BadRequestException('At least one valid role must be assigned');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    let user = this.userRepo.create({
      username: dto.username,
      email: dto.email,
      fullName: dto.fullName,
      passwordHash,
      status: 'ACTIVE',
      roles,
      createdBy: creatorUsername,
      updatedBy: creatorUsername,
    });

    user = await this.userRepo.save(user);

    // Save client accesses if specified
    if (dto.assignedClientIds && dto.assignedClientIds.length > 0) {
      const accesses = dto.assignedClientIds.map((clientId) =>
        this.clientAccessRepo.create({
          userId: user.id,
          clientId,
          accessLevel: 'OPERATOR',
          grantedBy: creatorUsername,
        })
      );
      await this.clientAccessRepo.save(accesses);
    }

    return this.getUserById(user.id);
  }

  async updateUser(id: string, dto: UpdateUserRequestDto, updaterUsername: string): Promise<UserSummary> {
    let user = await this.userRepo.findOne({
      where: { id },
      relations: ['roles', 'clientAccesses'],
    });
    if (!user) throw new NotFoundException('User not found');

    if (dto.fullName) user.fullName = dto.fullName;
    if (dto.email) user.email = dto.email;
    if (dto.status) user.status = dto.status;

    if (dto.roleIds) {
      const roles = await this.roleRepo.find({ where: { id: In(dto.roleIds) } });
      user.roles = roles;
    }

    user.updatedBy = updaterUsername;
    await this.userRepo.save(user);

    if (dto.assignedClientIds !== undefined) {
      // Remove old access mappings
      await this.clientAccessRepo.delete({ userId: user.id });

      // Insert new access mappings
      if (dto.assignedClientIds.length > 0) {
        const accesses = dto.assignedClientIds.map((clientId) =>
          this.clientAccessRepo.create({
            userId: user.id,
            clientId,
            accessLevel: 'OPERATOR',
            grantedBy: updaterUsername,
          })
        );
        await this.clientAccessRepo.save(accesses);
      }
    }

    return this.getUserById(user.id);
  }

  async unlockUser(id: string, updaterUsername: string): Promise<UserSummary> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    user.failedAttempts = 0;
    user.lockoutUntil = null;
    user.status = 'ACTIVE';
    user.updatedBy = updaterUsername;
    await this.userRepo.save(user);

    return this.getUserById(user.id);
  }

  private mapToSummary(user: ApplicationUser): UserSummary {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      failedAttempts: user.failedAttempts,
      lockoutUntil: user.lockoutUntil ? user.lockoutUntil.toISOString() : null,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      roles: (user.roles || []).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description || '',
        isSystem: r.isSystem,
        permissions: (r.permissions || []).map((p) => p.code as any),
      })),
      assignedClientIds: (user.clientAccesses || []).map((a) => a.clientId),
    };
  }
}
