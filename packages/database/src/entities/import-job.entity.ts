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
import { Client } from './client.entity.js';
import { ImportJobRow } from './import-job-row.entity.js';

@Entity('import_jobs')
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'SERVICE_MASTER' })
  jobType!: 'SERVICE_MASTER' | 'USER_CREATION';

  @Column({ type: 'nvarchar', length: 255 })
  originalFileName!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  storedFilePath?: string | null;

  @Column({ type: 'int', default: 0 })
  totalRows!: number;

  @Column({ type: 'int', default: 0 })
  processedRows!: number;

  @Column({ type: 'int', default: 0 })
  succeededRows!: number;

  @Column({ type: 'int', default: 0 })
  failedRows!: number;

  @Column({ type: 'int', default: 0 })
  skippedRows!: number;

  @Column({ type: 'nvarchar', length: 50, default: 'PENDING' })
  status!: 'PENDING' | 'VALIDATED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'PAUSED' | 'CANCELLED';

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  columnMappingsJson?: string | null;

  @Column({ type: 'bit', default: false })
  oneRecordTestMode!: boolean;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  typedConfirmation?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  summaryReportJson?: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  createdBy?: string;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  updatedBy?: string;

  @ManyToOne(() => Client, (client) => client.importJobs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client!: Client;

  @OneToMany(() => ImportJobRow, (row) => row.importJob, { cascade: true })
  rows!: ImportJobRow[];
}
