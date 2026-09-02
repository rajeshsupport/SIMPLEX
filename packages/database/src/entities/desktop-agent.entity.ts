import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApplicationUser } from './application-user.entity.js';
import { AutomationRun } from './automation-run.entity.js';

@Entity('desktop_agents')
export class DesktopAgent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 100 })
  agentName!: string;

  @Column({ type: 'nvarchar', length: 150 })
  machineHostname!: string;

  @Column({ type: 'nvarchar', length: 255 })
  osInfo!: string;

  @Column({ type: 'uniqueidentifier' })
  assignedUserId!: string;

  @Column({ type: 'nvarchar', length: 255 })
  authTokenHash!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'OFFLINE' })
  status!: 'ONLINE' | 'OFFLINE' | 'BUSY';

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  currentTaskDescription?: string | null;

  @Column({ type: 'datetime2', nullable: true })
  lastHeartbeatAt?: Date | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  systemMetricsJson?: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @ManyToOne(() => ApplicationUser, (user) => user.desktopAgents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignedUserId' })
  assignedUser!: ApplicationUser;

  @OneToMany(() => AutomationRun, (run) => run.desktopAgent)
  automationRuns!: AutomationRun[];
}
