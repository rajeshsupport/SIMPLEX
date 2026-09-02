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

@Entity('application_login_history')
export class ApplicationLoginHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uniqueidentifier' })
  userId!: string;

  @Index()
  @CreateDateColumn({ type: 'datetime2' })
  timestamp!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  ipAddress?: string | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  userAgent?: string | null;

  @Column({ type: 'nvarchar', length: 50, default: 'SUCCESS' })
  status!: 'SUCCESS' | 'FAILED_CREDENTIALS' | 'LOCKED_OUT';

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  failureReason?: string | null;

  @ManyToOne(() => ApplicationUser, (user) => user.loginHistory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: ApplicationUser;
}
