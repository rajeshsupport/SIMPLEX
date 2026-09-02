import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ImportJob } from './import-job.entity.js';

@Entity('import_job_rows')
@Index(['importJobId', 'rowIndex'], { unique: true })
export class ImportJobRow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  importJobId!: string;

  @Column({ type: 'int' })
  rowIndex!: number;

  @Column({ type: 'nvarchar', length: 'max' })
  rawDataJson!: string;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  mappedDataJson?: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 50, default: 'PENDING' })
  status!: 'PENDING' | 'VALIDATED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED' | 'REQUIRES_REVIEW';

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  errorMessage?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  resultJson?: string | null;

  @Column({ type: 'int', default: 0 })
  retryCount!: number;

  @Column({ type: 'datetime2', nullable: true })
  processedAt?: Date | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @ManyToOne(() => ImportJob, (job) => job.rows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'importJobId' })
  importJob!: ImportJob;
}
