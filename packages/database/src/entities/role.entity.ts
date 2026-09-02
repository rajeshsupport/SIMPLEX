import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
  Index,
} from 'typeorm';
import { Permission } from './permission.entity.js';
import { ApplicationUser } from './application-user.entity.js';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 100 })
  name!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description?: string;

  @Column({ type: 'bit', default: false })
  isSystem!: boolean;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  createdBy?: string;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  updatedBy?: string;

  @ManyToMany(() => Permission, (perm) => perm.roles, { eager: true })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions!: Permission[];

  @ManyToMany(() => ApplicationUser, (user) => user.roles)
  users!: ApplicationUser[];
}
