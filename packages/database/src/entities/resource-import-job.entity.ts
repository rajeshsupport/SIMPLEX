import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Client } from './client.entity.js';
import { ResourceImportRow } from './resource-import-row.entity.js';

@Entity('resource_import_jobs')
@Index('IDX_res_job_client', ['clientId', 'status'])
export class ResourceImportJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'nvarchar', length: 50 })
  clientCode!: string;

  @Column({ type: 'nvarchar', length: 255 })
  fileName!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'PENDING' })
  status!: 'PENDING' | 'PREVIEW' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';

  @Column({ type: 'int', default: 0 })
  totalRows!: number;

  @Column({ type: 'int', default: 0 })
  completedRows!: number;

  @Column({ type: 'int', default: 0 })
  failedRows!: number;

  @Column({ type: 'int', default: 0 })
  skippedRows!: number;

  @Column({ type: 'nvarchar', length: 100 })
  createdBy!: string;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client!: Client;

  @OneToMany(() => ResourceImportRow, (r) => r.job, { cascade: true })
  rows!: ResourceImportRow[];
}
