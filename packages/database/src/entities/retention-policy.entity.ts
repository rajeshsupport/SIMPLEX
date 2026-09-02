import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('retention_policies')
export class RetentionPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 100 })
  logType!: 'SCREENSHOTS' | 'ERROR_LOGS' | 'AUDIT_LOGS' | 'IMPORT_SUMMARIES';

  @Column({ type: 'int' })
  retentionDays!: number;

  @Column({ type: 'bit', default: false })
  isArchiveEnabled!: boolean;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  archiveDestination?: string | null;

  @Column({ type: 'datetime2', nullable: true })
  lastPurgedAt?: Date | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;
}
