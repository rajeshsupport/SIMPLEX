import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role, Permission } from '@hmc/database';
import { PermissionCode } from '@hmc/shared';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
    @InjectRepository(Permission)
    private permRepo: Repository<Permission>
  ) {}

  async getAllPermissions(): Promise<Permission[]> {
    return this.permRepo.find({ order: { category: 'ASC', code: 'ASC' } });
  }

  async getAllRoles(): Promise<Role[]> {
    return this.roleRepo.find({
      relations: ['permissions'],
      order: { isSystem: 'DESC', name: 'ASC' },
    });
  }

  async getRoleById(id: string): Promise<Role> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: ['permissions'],
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async createRole(dto: { name: string; description?: string; permissionCodes: PermissionCode[] }, username: string): Promise<Role> {
    const existing = await this.roleRepo.findOne({ where: { name: dto.name } });
    if (existing) throw new BadRequestException('Role name already exists');

    const perms = await this.permRepo.find({
      where: { code: In(dto.permissionCodes) },
    });

    const role = this.roleRepo.create({
      name: dto.name,
      description: dto.description,
      isSystem: false,
      permissions: perms,
      createdBy: username,
      updatedBy: username,
    });

    return this.roleRepo.save(role);
  }

  async updateRole(
    id: string,
    dto: { name?: string; description?: string; permissionCodes?: PermissionCode[] },
    username: string
  ): Promise<Role> {
    const role = await this.getRoleById(id);
    if (role.isSystem && dto.name && dto.name !== role.name) {
      throw new BadRequestException('Cannot rename system role');
    }

    if (dto.name) role.name = dto.name;
    if (dto.description !== undefined) role.description = dto.description;

    if (dto.permissionCodes) {
      role.permissions = await this.permRepo.find({
        where: { code: In(dto.permissionCodes) },
      });
    }

    role.updatedBy = username;
    return this.roleRepo.save(role);
  }
}
