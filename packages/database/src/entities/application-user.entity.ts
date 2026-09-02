import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
  OneToMany,
  Index,
} from 'typeorm';
import { Role } from './role.entity.js';
import { UserClientAccess } from './user-client-access.entity.js';
import { ApplicationLoginHistory } from './application-login-history.entity.js';
import { DesktopAgent } from './desktop-agent.entity.js';

@Entity('application_users')
export class ApplicationUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 100 })
  username!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 255 })
  email!: string;

  @Column({ type: 'nvarchar', length: 150 })
  fullName!: string;

  @Column({ type: 'nvarchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'nvarchar', length: 20, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE' | 'LOCKED';

  @Column({ type: 'int', default: 0 })
  failedAttempts!: number;

  @Column({ type: 'datetime2', nullable: true })
  lockoutUntil?: Date | null;

  @Column({ type: 'datetime2', nullable: true })
  lastLoginAt?: Date | null;

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  refreshTokenHash?: string | null;

  @Column({ type: 'bit', default: false })
  requirePasswordChange!: boolean;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  createdBy?: string;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  updatedBy?: string;

  @ManyToMany(() => Role, (role) => role.users, { eager: true })
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles!: Role[];

  @OneToMany(() => UserClientAccess, (uca) => uca.user)
  clientAccesses!: UserClientAccess[];

  @OneToMany(() => ApplicationLoginHistory, (history) => history.user)
  loginHistory!: ApplicationLoginHistory[];

  @OneToMany(() => DesktopAgent, (agent) => agent.assignedUser)
  desktopAgents!: DesktopAgent[];
}
