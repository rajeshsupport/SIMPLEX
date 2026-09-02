import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../common/decorators/user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  CreateUserRequestSchema,
  CreateUserRequestDto,
  UpdateUserRequestSchema,
  UpdateUserRequestDto,
  PERMISSIONS,
} from '@hmc/shared';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.APPLICATION_USER_MANAGE)
  async getAllUsers() {
    return this.usersService.getAllUsers();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APPLICATION_USER_MANAGE)
  async getUserById(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.APPLICATION_USER_MANAGE)
  async createUser(
    @Body(new ZodValidationPipe(CreateUserRequestSchema)) dto: CreateUserRequestDto,
    @CurrentUser('username') username: string
  ) {
    return this.usersService.createUser(dto, username);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.APPLICATION_USER_MANAGE)
  async updateUser(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserRequestSchema)) dto: UpdateUserRequestDto,
    @CurrentUser('username') username: string
  ) {
    return this.usersService.updateUser(id, dto, username);
  }

  @Post(':id/unlock')
  @RequirePermissions(PERMISSIONS.APPLICATION_USER_MANAGE)
  async unlockUser(
    @Param('id') id: string,
    @CurrentUser('username') username: string
  ) {
    return this.usersService.unlockUser(id, username);
  }
}
