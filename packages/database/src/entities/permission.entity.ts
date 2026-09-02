import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToMany,
  Index,
} from 'typeorm';
import { Role } from './role.entity.js';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 100 })
  code!: string;

  @Column({ type: 'nvarchar', length: 150 })
  name!: string;

  @Column({ type: 'nvarchar', length: 100 })
  category!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description?: string;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @ManyToMany(() => Role, (role) => role.permissions)
  roles!: Role[];
}
