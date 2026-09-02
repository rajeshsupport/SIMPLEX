import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApplicationUser } from './application-user.entity.js';
import { Client } from './client.entity.js';

@Entity('user_client_access')
@Index(['userId', 'clientId'], { unique: true })
export class UserClientAccess {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  userId!: string;

  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'OPERATOR' })
  accessLevel!: 'READ_ONLY' | 'OPERATOR' | 'ADMIN';

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  grantedBy?: string;

  @ManyToOne(() => ApplicationUser, (user) => user.clientAccesses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: ApplicationUser;

  @ManyToOne(() => Client, (client) => client.userAccesses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client!: Client;
}
